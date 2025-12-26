import os
import re
import json
import zipfile
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request, status
from fastapi.responses import FileResponse
from sqlmodel import select

from .db import get_session
from .auth import get_current_user
from .models import Package
from .audit_utils import log_event, diff_dicts
from .robot_dependencies import get_current_robot
from .permissions import require_permission

router = APIRouter(prefix="/packages", tags=["packages"])

PACKAGE_DIR = os.path.join(os.path.dirname(__file__), "packages_store")
os.makedirs(PACKAGE_DIR, exist_ok=True)

SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")
NAME_VER_RE = re.compile(r"^(?P<name>[A-Za-z0-9_-]+)_(?P<version>\d+\.\d+\.\d+)$")

def now_iso():
    return datetime.now().isoformat(timespec='seconds')

def parse_scripts_from_zip(file_path: str) -> List[str]:
    scripts: List[str] = []
    try:
        with zipfile.ZipFile(file_path, 'r') as z:
            for info in z.infolist():
                if not info.is_dir() and info.filename.endswith('.py'):
                    scripts.append(info.filename)
    except Exception:
        pass
    return scripts

def to_out(pkg: Package) -> dict:
    scripts: List[str] = []
    try:
        scripts = json.loads(pkg.scripts_manifest or "[]")
    except Exception:
        scripts = []
    return {
        "id": pkg.id,
        "name": pkg.name,
        "version": pkg.version,
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
    if not filename.lower().endswith('.zip'):
        raise HTTPException(status_code=400, detail="File must be a .zip")
    base = os.path.splitext(os.path.basename(filename))[0]
    parsed_name = None
    parsed_version = None
    m = NAME_VER_RE.match(base)
    if m:
        parsed_name = m.group('name')
        parsed_version = m.group('version')

    if name:
        name = name.strip()
    else:
        if parsed_name:
            name = parsed_name
        else:
            raise HTTPException(status_code=400, detail="filename must be name_version.zip where version is X.X.X or provide name explicitly")

    if version:
        version = version.strip()
    else:
        if parsed_version:
            version = parsed_version
        else:
            raise HTTPException(status_code=400, detail="filename must be name_version.zip where version is X.X.X or provide version explicitly")

    if not SEMVER_RE.match(version):
        raise HTTPException(status_code=400, detail="version must match X.X.X")

    # Enforce (name, version) uniqueness
    existing = session.exec(select(Package).where(Package.name == name).where(Package.version == version)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Package name+version already exists")

    safe_filename = f"{name}_{version}.zip"
    dest_path = os.path.join(PACKAGE_DIR, safe_filename)
    with open(dest_path, 'wb') as out:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)

    scripts = parse_scripts_from_zip(dest_path)

    pkg = Package(
        name=name,
        version=version,
        file_path=dest_path,
        scripts_manifest=json.dumps(scripts),
        is_active=True,
        created_at=now_iso(),
        updated_at=now_iso(),
    )
    session.add(pkg)
    session.commit()
    session.refresh(pkg)
    out = to_out(pkg)
    try:
        log_event(session, action="package.upload", entity_type="package", entity_id=pkg.id, entity_name=f"{pkg.name}:{pkg.version}", before=None, after=out, metadata={"scripts": scripts}, request=request, user=user)
    except Exception:
        pass
    return out

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
    before_out = to_out(p)
    if "is_active" in payload and payload.get("is_active") is not None:
        p.is_active = bool(payload["is_active"])
    if "name" in payload and payload.get("name"):
        new_name = str(payload["name"]).strip()
        if new_name != p.name:
            # uniqueness check with version
            if session.exec(select(Package).where(Package.name == new_name).where(Package.version == p.version)).first():
                raise HTTPException(status_code=400, detail="Package name+version already exists")
            p.name = new_name
    if "version" in payload and payload.get("version"):
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
    if not os.path.exists(p.file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Package file missing")
    return FileResponse(
        p.file_path,
        media_type="application/zip",
        filename=os.path.basename(p.file_path),
    )
