import os
import re
import json
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request, status
from fastapi.responses import FileResponse
from sqlmodel import select

from .db import get_session
from .auth import get_current_user
from .models import Package
from .bvpackage import BvPackageValidationError, validate_and_extract_bvpackage
from .audit_utils import log_event, diff_dicts
from .robot_dependencies import get_current_robot
from .permissions import require_permission

router = APIRouter(prefix="/packages", tags=["packages"])

PACKAGE_DIR = os.path.join(os.path.dirname(__file__), "packages_store")
os.makedirs(PACKAGE_DIR, exist_ok=True)

SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")
NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")

BVPACKAGE_ONLY_UPLOAD_ERROR = "Only .bvpackage files are supported"
LEGACY_REBUILD_MESSAGE = "Legacy ZIP packages are no longer supported. Rebuild and upload as .bvpackage."


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

def to_out(pkg: Package) -> dict:
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
    return {
        "id": pkg.id,
        "name": pkg.name,
        "version": pkg.version,
        "is_bvpackage": bool(getattr(pkg, "is_bvpackage", False)),
        "entrypoints": entrypoints,
        "default_entrypoint": pkg.default_entrypoint,
        "is_active": pkg.is_active,
        "scripts": scripts,
        "created_at": pkg.created_at,
        "updated_at": pkg.updated_at,
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

    pkg = Package(
        name=name,
        version=version,
        file_path=dest_path,
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
    out = to_out(pkg)
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
    return [to_out(p) for p in pkgs]

@router.get("/{pkg_id}", dependencies=[Depends(get_current_user), Depends(require_permission("packages", "view"))])
def get_package(pkg_id: int, session=Depends(get_session)):
    p = session.exec(select(Package).where(Package.id == pkg_id)).first()
    if not p:
        raise HTTPException(status_code=404, detail="Package not found")
    return to_out(p)

@router.put("/{pkg_id}", dependencies=[Depends(get_current_user), Depends(require_permission("packages", "edit"))])
def update_package(pkg_id: int, payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    p = session.exec(select(Package).where(Package.id == pkg_id)).first()
    if not p:
        raise HTTPException(status_code=404, detail="Package not found")
    if not bool(getattr(p, "is_bvpackage", False)):
        raise HTTPException(status_code=400, detail=LEGACY_REBUILD_MESSAGE)
    before_out = to_out(p)
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
    after_out = to_out(p)
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
    before_out = to_out(p)
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
    return FileResponse(
        p.file_path,
        media_type="application/zip",
        filename=os.path.basename(p.file_path),
    )
