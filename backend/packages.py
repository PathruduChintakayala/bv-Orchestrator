import ast
import os
import re
import json
import zipfile
import hashlib
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request, status
from fastapi.responses import FileResponse
from sqlmodel import select

from backend.db import get_session
from backend.auth import get_current_user
from backend.models import Package, Process
from backend.bvpackage import BvPackageValidationError, validate_and_extract_bvpackage
from backend.audit_utils import log_event, diff_dicts
from backend.robot_dependencies import get_current_robot
from backend.permissions import require_permission

router = APIRouter(prefix="/packages", tags=["packages"])

PACKAGE_DIR = os.path.join(os.path.dirname(__file__), "packages_store")
os.makedirs(PACKAGE_DIR, exist_ok=True)

SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")
NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")

BVPACKAGE_ONLY_UPLOAD_ERROR = "Only .bvpackage files are supported"
LEGACY_REBUILD_MESSAGE = "Legacy ZIP packages are no longer supported. Rebuild and upload as .bvpackage."


def _compute_file_hash(path: str) -> tuple[str, int]:
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Package file not found")
    h = hashlib.sha256()
    size = 0
    with open(path, "rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            h.update(chunk)
    return h.hexdigest(), size


def ensure_package_metadata(pkg: Package, session, *, verify: bool = False) -> Package:
    """Ensure pkg.hash and pkg.size_bytes are populated (and optionally verified)."""
    if not pkg.file_path:
        raise HTTPException(status_code=404, detail="Package file missing")
    digest = getattr(pkg, "hash", None)
    size = getattr(pkg, "size_bytes", None)
    needs_hash = not digest
    needs_size = size in (None, 0)
    computed_digest = None
    computed_size = None
    if needs_hash or needs_size or verify:
        computed_digest, computed_size = _compute_file_hash(pkg.file_path)
    if needs_hash:
        digest = computed_digest
        pkg.hash = digest
    if needs_size:
        size = computed_size
        pkg.size_bytes = size
    if (verify and digest and computed_digest and digest != computed_digest):
        raise HTTPException(status_code=409, detail="Package hash mismatch; re-upload required")
    if needs_hash or needs_size:
        session.add(pkg)
        session.commit()
        session.refresh(pkg)
    return pkg


def _open_zip(pkg: Package) -> zipfile.ZipFile:
    if not pkg.file_path or not os.path.exists(pkg.file_path):
        raise HTTPException(status_code=404, detail="Package file not found")
    try:
        return zipfile.ZipFile(pkg.file_path, "r")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read package archive: {e}")


def _load_entrypoint_record(pkg: Package, entrypoint_name: str) -> tuple[str, str]:
    """Return (file_path_in_zip, function_name) for the given entrypoint.

    Expects entry-points.json to contain key "entryPoints" with name/filePath/function.
    """
    entrypoint_name = (entrypoint_name or "").strip()
    with _open_zip(pkg) as zf:
        try:
            raw = zf.read("entry-points.json").decode("utf-8")
            data = json.loads(raw)
        except KeyError:
            raise HTTPException(status_code=400, detail="entry-points.json missing from package")
        except Exception:
            raise HTTPException(status_code=400, detail="entry-points.json is not valid JSON")

        eps = data.get("entryPoints") if isinstance(data, dict) else None
        if not isinstance(eps, list):
            raise HTTPException(status_code=400, detail="entry-points.json: entryPoints must be a list")
        for ep in eps:
            if not isinstance(ep, dict):
                continue
            if ep.get("name") == entrypoint_name:
                file_path = ep.get("filePath") or ep.get("path")
                func_name = ep.get("function") or ep.get("fn")
                if not file_path or not func_name:
                    break
                return file_path, func_name
    raise HTTPException(status_code=404, detail=f"Entrypoint '{entrypoint_name}' not found in package")


def _infer_type_from_annotation(annotation: str) -> str:
    ann = (annotation or "").lower()
    if not ann:
        return "any"
    if "int" in ann and "str" not in ann:
        return "int"
    if "float" in ann or "double" in ann:
        return "float"
    if "bool" in ann:
        return "bool"
    if "list" in ann or "[]" in ann:
        return "list"
    if "dict" in ann or "mapping" in ann:
        return "dict"
    if "str" in ann or "text" in ann:
        return "string"
    return "any"


def _parse_function_signature(source: str, func_name: str) -> list[dict]:
    try:
        tree = ast.parse(source)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse function source: {e}")

    target = None
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == func_name:
            target = node
            break
    if target is None:
        raise HTTPException(status_code=404, detail=f"Function '{func_name}' not found in module")

    params: list[dict] = []

    def _annotation_to_str(ann_node):
        if ann_node is None:
            return ""
        try:
            return ast.unparse(ann_node)
        except Exception:
            return ""

    def _default_value(node):
        try:
            return ast.literal_eval(node)
        except Exception:
            return None

    args = target.args
    total_defaults = list(args.defaults or [])
    pos_args = list(args.args or [])
    defaults_offset = len(pos_args) - len(total_defaults)

    for idx, arg in enumerate(pos_args):
        ann_str = _annotation_to_str(arg.annotation)
        default_node = total_defaults[idx - defaults_offset] if idx >= defaults_offset else None
        default_value = _default_value(default_node) if default_node is not None else None
        params.append({
            "name": arg.arg,
            "annotation": ann_str,
            "type": _infer_type_from_annotation(ann_str),
            "required": default_node is None,
            "default": default_value,
            "kind": "positional",
        })

    for kwarg, default_node in zip(args.kwonlyargs or [], args.kw_defaults or []):
        ann_str = _annotation_to_str(kwarg.annotation)
        default_value = _default_value(default_node) if default_node is not None else None
        params.append({
            "name": kwarg.arg,
            "annotation": ann_str,
            "type": _infer_type_from_annotation(ann_str),
            "required": default_node is None,
            "default": default_value,
            "kind": "keyword_only",
        })

    if args.vararg:
        ann_str = _annotation_to_str(args.vararg.annotation)
        params.append({
            "name": args.vararg.arg,
            "annotation": ann_str,
            "type": "varargs",
            "required": False,
            "default": None,
            "kind": "varargs",
        })
    if args.kwarg:
        ann_str = _annotation_to_str(args.kwarg.annotation)
        params.append({
            "name": args.kwarg.arg,
            "annotation": ann_str,
            "type": "varkw",
            "required": False,
            "default": None,
            "kind": "varkw",
        })

    return params


def _can_publish_package_name_version(session, *, name: Optional[str], version: Optional[str]) -> tuple[bool, Optional[str]]:
    """Pure check: validate publishability of name+version.

    No side-effects: does not create/update any records.
    """
    normalized_name = (name or "").strip()
    if not normalized_name:
        return False, "name is required"
    if not NAME_RE.match(normalized_name):
        return False, "name must match [A-Za-z0-9_-]"

    normalized_version = (version or "").strip()
    if not normalized_version:
        return False, "version is required"
    if not SEMVER_RE.match(normalized_version):
        return False, "version must be SemVer 'X.Y.Z'"

    existing = session.exec(
        select(Package).where(Package.name == normalized_name).where(Package.version == normalized_version)
    ).first()
    if existing:
        return False, f"Package {normalized_name}@{normalized_version} already exists"
    return True, None


def _require_can_publish(session, *, name: str, version: str) -> None:
    can, reason = _can_publish_package_name_version(session, name=name, version=version)
    if not can:
        raise HTTPException(status_code=400, detail=reason or "Package cannot be published")

def now_iso():
    return datetime.now().isoformat(timespec='seconds')

def recompute_package_active(session, pkg_id: Optional[int]) -> Optional[bool]:
    """Re-evaluate whether a package version is active based on live process associations."""
    if pkg_id is None:
        return None
    pkg = session.exec(select(Package).where(Package.id == pkg_id)).first()
    if not pkg:
        return None
    has_process = session.exec(select(Process.id).where(Process.package_id == pkg_id)).first() is not None
    new_active = bool(has_process)
    if pkg.is_active != new_active:
        pkg.is_active = new_active
        pkg.updated_at = now_iso()
        session.add(pkg)
        session.commit()
        session.refresh(pkg)
    return new_active


def to_out(pkg: Package, session=None) -> dict:
    scripts: List[str] = []
    try:
        scripts = json.loads(pkg.scripts_manifest or "[]")
    except Exception:
        scripts = []
    entrypoints = None
    try:
        entrypoints = json.loads(pkg.entrypoints) if pkg.entrypoints else None
    except Exception:
        entrypoints = None
    download_available = bool(getattr(pkg, "file_path", None) and os.path.exists(getattr(pkg, "file_path")))
    download_url = None
    if download_available and bool(getattr(pkg, "is_bvpackage", False)):
        download_url = f"/api/packages/{pkg.id}/versions/{pkg.version}/download"
    # Keep is_active derived from live process associations when a session is available.
    active = pkg.is_active
    if session is not None:
        computed_active = recompute_package_active(session, pkg.id)
        if computed_active is not None:
            active = computed_active

    return {
        "id": pkg.id,
        "name": pkg.name,
        "version": pkg.version,
        "is_bvpackage": bool(getattr(pkg, "is_bvpackage", False)),
        "entrypoints": entrypoints,
        "default_entrypoint": pkg.default_entrypoint,
        "is_active": active,
        "hash": getattr(pkg, "hash", None),
        "size_bytes": getattr(pkg, "size_bytes", None),
        "scripts": scripts,
        "created_at": pkg.created_at,
        "updated_at": pkg.updated_at,
        "download_url": download_url,
        "download_available": download_available,
    }

@router.post("/upload", dependencies=[Depends(get_current_user), Depends(require_permission("packages", "create"))])
def upload_package(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    version: Optional[str] = Form(None),
    request: Request = None,
    session=Depends(get_session),
    user=Depends(get_current_user),
):
    filename = file.filename or ""
    is_bv = filename.lower().endswith('.bvpackage')
    if not is_bv:
        raise HTTPException(status_code=400, detail=BVPACKAGE_ONLY_UPLOAD_ERROR)
    base = os.path.splitext(os.path.basename(filename))[0]

    # bvpackage name/version are authoritative inside bvproject.yaml.
    name = (name.strip() if name else None)
    version = (version.strip() if version else None)

    # Stage upload to disk first.
    safe_filename = f"{base}.bvpackage"
    dest_path = os.path.join(PACKAGE_DIR, safe_filename)
    with open(dest_path, 'wb') as out:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)

    try:
        info = validate_and_extract_bvpackage(dest_path)
    except BvPackageValidationError as e:
        # Cleanup staged file on invalid upload.
        try:
            if os.path.exists(dest_path):
                os.remove(dest_path)
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=str(e))

    # If caller supplied name/version, they must match bvproject.yaml.
    if name and name != info.package_name:
        try:
            if os.path.exists(dest_path):
                os.remove(dest_path)
        except Exception:
            pass
        raise HTTPException(
            status_code=400,
            detail=f"Provided name '{name}' does not match bvproject.yaml name '{info.package_name}'",
        )
    if version and version != info.version:
        try:
            if os.path.exists(dest_path):
                os.remove(dest_path)
        except Exception:
            pass
        raise HTTPException(
            status_code=400,
            detail=f"Provided version '{version}' does not match bvproject.yaml version '{info.version}'",
        )

    name = info.package_name
    version = info.version

    # Ensure acceptance rules are identical to preflight.
    try:
        _require_can_publish(session, name=name, version=version)
    except HTTPException:
        try:
            if os.path.exists(dest_path):
                os.remove(dest_path)
        except Exception:
            pass
        raise

    entrypoints = json.dumps(info.entrypoints)
    default_entrypoint = info.default_entrypoint_name

    scripts: List[str] = []

    safe_filename = f"{name}_{version}.bvpackage"
    new_path = os.path.join(PACKAGE_DIR, safe_filename)
    if new_path != dest_path:
        try:
            os.replace(dest_path, new_path)
            dest_path = new_path
        except Exception:
            pass

    # Compute hash + size for integrity
    digest, size_bytes = _compute_file_hash(dest_path)
    existing_hash = session.exec(select(Package).where(Package.hash == digest)).first()
    if existing_hash:
        try:
            if os.path.exists(dest_path):
                os.remove(dest_path)
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=f"Package binary already uploaded as {existing_hash.name}@{existing_hash.version}")

    pkg = Package(
        name=name,
        version=version,
        file_path=dest_path,
        hash=digest,
        size_bytes=size_bytes,
        scripts_manifest=None,
        is_bvpackage=True,
        entrypoints=entrypoints,
        default_entrypoint=default_entrypoint,
        is_active=True,
        created_at=now_iso(),
        updated_at=now_iso(),
    )
    session.add(pkg)
    session.commit()
    session.refresh(pkg)
    out = to_out(pkg, session)
    try:
        metadata = {"entrypoints": json.loads(entrypoints or "[]"), "default_entrypoint": default_entrypoint}
        log_event(session, action="package.upload", entity_type="package", entity_id=pkg.id, entity_name=f"{pkg.name}:{pkg.version}", before=None, after=out, metadata=metadata, request=request, user=user)
    except Exception:
        pass
    return out


@router.post(
    "/preflight",
    dependencies=[Depends(get_current_user), Depends(require_permission("packages", "create"))],
)
def preflight_publish(payload: dict, session=Depends(get_session)):
    """Check whether a BV package can be published.

    Always returns HTTP 200. Does not upload/inspect files and does not mutate state.
    """
    can, reason = _can_publish_package_name_version(
        session,
        name=payload.get("name"),
        version=payload.get("version"),
    )
    if can:
        return {"can_publish": True}
    return {"can_publish": False, "reason": reason or "Package cannot be published"}

@router.get("/", dependencies=[Depends(get_current_user), Depends(require_permission("packages", "view"))])
def list_packages(search: Optional[str] = None, active_only: Optional[bool] = None, name: Optional[str] = None, session=Depends(get_session)):
    pkgs = session.exec(select(Package)).all()
    if name:
        pkgs = [p for p in pkgs if p.name == name]
    if search:
        s = search.lower()
        pkgs = [p for p in pkgs if s in p.name.lower()]
    if active_only:
        pkgs = [p for p in pkgs if p.is_active]
    pkgs.sort(key=lambda p: (p.name.lower(), p.version))
    out = []
    for p in pkgs:
        try:
            ensure_package_metadata(p, session)
        except Exception:
            pass
        out.append(to_out(p, session))
    return out

@router.get("/{pkg_id}", dependencies=[Depends(get_current_user), Depends(require_permission("packages", "view"))])
def get_package(pkg_id: int, session=Depends(get_session)):
    p = session.exec(select(Package).where(Package.id == pkg_id)).first()
    if not p:
        raise HTTPException(status_code=404, detail="Package not found")
    try:
        ensure_package_metadata(p, session)
    except Exception:
        pass
    return to_out(p, session)


@router.get(
    "/{pkg_id}/versions/{version}",
    dependencies=[Depends(get_current_user), Depends(require_permission("packages", "view"))],
)
def get_package_version(pkg_id: int, version: str, session=Depends(get_session)):
    pkg = session.exec(select(Package).where(Package.id == pkg_id).where(Package.version == version)).first()
    if not pkg:
        raise HTTPException(status_code=404, detail="Package version not found")
    pkg = ensure_package_metadata(pkg, session)
    return {
        "packageId": pkg.id,
        "packageName": pkg.name,
        "version": pkg.version,
        "hash": pkg.hash,
        "sizeBytes": pkg.size_bytes,
        "downloadUrl": f"/api/packages/{pkg.id}/versions/{pkg.version}/download",
    }


@router.get(
    "/{pkg_id}/versions/{version}/download",
    dependencies=[Depends(get_current_user), Depends(require_permission("packages", "view"))],
)
def download_package_version(
    pkg_id: int,
    version: str,
    request: Request,
    session=Depends(get_session),
    user=Depends(get_current_user),
):
    pkg = session.exec(select(Package).where(Package.id == pkg_id).where(Package.version == version)).first()
    if not pkg or not pkg.file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Package version not found")
    if not bool(getattr(pkg, "is_bvpackage", False)):
        raise HTTPException(status_code=400, detail=LEGACY_REBUILD_MESSAGE)
    if not os.path.exists(pkg.file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Package file missing")

    pkg = ensure_package_metadata(pkg, session, verify=True)
    filename = f"{pkg.name}-{pkg.version}.bvpackage"
    try:
        log_event(
            session,
            action="package.download",
            entity_type="package",
            entity_id=pkg.id,
            entity_name=f"{pkg.name}:{pkg.version}",
            before=None,
            after=None,
            metadata={"size_bytes": getattr(pkg, "size_bytes", None)},
            request=request,
            user=user,
        )
    except Exception:
        pass

    return FileResponse(
        pkg.file_path,
        media_type="application/zip",
        filename=filename,
    )


@router.get(
    "/{pkg_id}/entrypoints/{entrypoint_name}/signature",
    dependencies=[Depends(get_current_user), Depends(require_permission("packages", "view"))],
)
def get_entrypoint_signature(pkg_id: int, entrypoint_name: str, session=Depends(get_session)):
    pkg = session.exec(select(Package).where(Package.id == pkg_id)).first()
    if not pkg:
        raise HTTPException(status_code=404, detail="Package not found")
    if not bool(getattr(pkg, "is_bvpackage", False)):
        raise HTTPException(status_code=400, detail="Entrypoint signature only available for BV packages")

    file_in_zip, func_name = _load_entrypoint_record(pkg, entrypoint_name)
    with _open_zip(pkg) as zf:
        try:
            source = zf.read(file_in_zip).decode("utf-8")
        except KeyError:
            raise HTTPException(status_code=404, detail=f"Entrypoint file '{file_in_zip}' not found in package")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to read entrypoint source: {e}")

    params = _parse_function_signature(source, func_name)
    return {"parameters": params}

@router.put("/{pkg_id}", dependencies=[Depends(get_current_user), Depends(require_permission("packages", "edit"))])
def update_package(pkg_id: int, payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    p = session.exec(select(Package).where(Package.id == pkg_id)).first()
    if not p:
        raise HTTPException(status_code=404, detail="Package not found")
    if not bool(getattr(p, "is_bvpackage", False)):
        raise HTTPException(status_code=400, detail=LEGACY_REBUILD_MESSAGE)
    before_out = to_out(p, session)
    if "is_active" in payload and payload.get("is_active") is not None:
        p.is_active = bool(payload["is_active"])
    if "name" in payload and payload.get("name"):
        if bool(getattr(p, "is_bvpackage", False)):
            raise HTTPException(status_code=400, detail="BV package name is immutable")
        new_name = str(payload["name"]).strip()
        if new_name != p.name:
            # uniqueness check with version
            if session.exec(select(Package).where(Package.name == new_name).where(Package.version == p.version)).first():
                raise HTTPException(status_code=400, detail="Package name+version already exists")
            p.name = new_name
    if "version" in payload and payload.get("version"):
        if bool(getattr(p, "is_bvpackage", False)):
            raise HTTPException(status_code=400, detail="BV package version is immutable")
        new_version = str(payload["version"]).strip()
        if not SEMVER_RE.match(new_version):
            raise HTTPException(status_code=400, detail="version must match X.X.X")
        if new_version != p.version:
            if session.exec(select(Package).where(Package.name == p.name).where(Package.version == new_version)).first():
                raise HTTPException(status_code=400, detail="Package name+version already exists")
            p.version = new_version
    p.updated_at = now_iso()
    session.add(p)
    session.commit()
    session.refresh(p)
    after_out = to_out(p, session)
    try:
        changes = diff_dicts(before_out, after_out)
        log_event(session, action="package.update", entity_type="package", entity_id=p.id, entity_name=f"{p.name}:{p.version}", before=before_out, after=after_out, metadata={"changed_keys": list(changes.keys()), "diff": changes}, request=request, user=user)
    except Exception:
        pass
    return after_out

@router.delete("/{pkg_id}", status_code=204, dependencies=[Depends(get_current_user), Depends(require_permission("packages", "delete"))])
def delete_package(pkg_id: int, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    p = session.exec(select(Package).where(Package.id == pkg_id)).first()
    if not p:
        raise HTTPException(status_code=404, detail="Package not found")
    # Prevent deleting a package version that is still referenced by any process.
    in_use = session.exec(select(Process.id).where(Process.package_id == pkg_id)).first()
    if in_use:
        raise HTTPException(status_code=400, detail="Cannot delete package version while processes still reference it")
    before_out = to_out(p, session)
    # Best-effort delete zip
    try:
        if p.file_path and os.path.exists(p.file_path):
            os.remove(p.file_path)
    except Exception:
        pass
    session.delete(p)
    session.commit()
    try:
        log_event(session, action="package.delete", entity_type="package", entity_id=pkg_id, entity_name=f"{before_out.get('name')}:{before_out.get('version')}", before=before_out, after=None, metadata=None, request=request, user=user)
    except Exception:
        pass
    return None


@router.get("/{package_id}/download")
def download_package(
    package_id: int,
    session=Depends(get_session),
    robot=Depends(get_current_robot),
):
    p = session.exec(select(Package).where(Package.id == package_id)).first()
    if not p or not p.file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Package not found")
    if not bool(getattr(p, "is_bvpackage", False)):
        raise HTTPException(status_code=400, detail=LEGACY_REBUILD_MESSAGE)
    if not os.path.exists(p.file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Package file missing")
    # Verify integrity before serving
    p = ensure_package_metadata(p, session, verify=True)
    return FileResponse(
        p.file_path,
        media_type="application/zip",
        filename=os.path.basename(p.file_path),
    )
