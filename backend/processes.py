from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import select

from backend.db import get_session
from backend.auth import get_current_user
from backend.models import Process, Package
from backend.bvpackage import entrypoint_exists
from backend.permissions import require_permission
from backend.audit_utils import log_event, diff_dicts

router = APIRouter(prefix="/processes", tags=["processes"])


def now_iso():
    return datetime.now().isoformat(timespec='seconds')


def _parse_semver(version: str) -> tuple[int, int, int]:
    try:
        parts = version.strip().split('.')
        major, minor, patch = (int(parts[0]), int(parts[1]), int(parts[2]))
        return major, minor, patch
    except Exception:
        # Fallback to treat invalid strings as 0.0.0 so we do not crash.
        return 0, 0, 0


def _latest_package_for_name(session, name: str) -> Optional[Package]:
    if not name:
        return None
    pkgs = session.exec(select(Package).where(Package.name == name)).all()
    if not pkgs:
        return None
    pkgs.sort(key=lambda p: _parse_semver(p.version), reverse=True)
    return pkgs[0]


def _recompute_package_active(session, pkg_id: Optional[int]):
    """Ensure package.is_active reflects whether any processes reference it."""
    if pkg_id is None:
        return
    pkg = session.exec(select(Package).where(Package.id == pkg_id)).first()
    if not pkg:
        return
    has_process = session.exec(select(Process.id).where(Process.package_id == pkg_id)).first() is not None
    new_active = bool(has_process)
    if pkg.is_active != new_active:
        pkg.is_active = new_active
        pkg.updated_at = now_iso()
        session.add(pkg)
        session.commit()
        session.refresh(pkg)


def _process_type_from_package(pkg: Optional[Package]) -> str:
    ptype = getattr(pkg, "type", None) or "rpa"
    if ptype not in ("rpa", "agent"):
        return "rpa"
    return ptype


def process_to_out(p: Process, session=None) -> dict:
    pkg_out = None
    latest_version = None
    upgrade_available = False
    if p.package_id and session is not None:
        pkg = session.exec(select(Package).where(Package.id == p.package_id)).first()
        if pkg:
            from backend.packages import to_out as pkg_to_out
            pkg_out = pkg_to_out(pkg, session)
            latest_pkg = _latest_package_for_name(session, pkg.name)
            if latest_pkg:
                latest_version = latest_pkg.version
                upgrade_available = _parse_semver(latest_pkg.version) > _parse_semver(pkg.version)
    return {
        "id": getattr(p, "external_id", None) or str(p.id),
        "_internal_id": p.id,  # deprecated: prefer id (external_id)
        "name": p.name,
        "description": p.description,
        "package_id": p.package_id,
        "entrypoint_name": getattr(p, "entrypoint_name", None),
        "script_path": p.script_path,
        "version": p.version,
        "type": getattr(p, "type", None) or "rpa",
        "created_at": p.created_at,
        "updated_at": p.updated_at,
        "package": pkg_out,
        "latest_version": latest_version,
        "upgrade_available": upgrade_available,
    }


def _load_package(session, package_id: Optional[int]) -> Optional[Package]:
    if package_id is None:
        return None
    try:
        pid = int(package_id)
    except Exception:
        raise HTTPException(status_code=400, detail="package_id must be an integer")
    pkg = session.exec(select(Package).where(Package.id == pid)).first()
    if not pkg:
        raise HTTPException(status_code=400, detail="Selected package does not exist")
    return pkg


def _validate_process_payload(session, payload: dict) -> dict:
    """Validate process definition rules for bvpackage vs legacy packages.

    Returns normalized fields: package_id, script_path, entrypoint_name.
    """
    package_id = payload.get("package_id")
    entrypoint_name = (payload.get("entrypoint_name") or "").strip() or None
    script_path_in = payload.get("script_path")
    script_path = (script_path_in or "").strip() if script_path_in is not None else None

    pkg = _load_package(session, package_id) if package_id is not None else None
    if pkg and bool(getattr(pkg, "is_bvpackage", False)):
        if not entrypoint_name:
            raise HTTPException(status_code=400, detail="entrypoint_name is required when package is a BV package")
        if not entrypoint_exists(getattr(pkg, "entrypoints", None), entrypoint_name):
            raise HTTPException(status_code=400, detail=f"entrypoint_name '{entrypoint_name}' does not exist in the selected BV package")
        # script_path must be null/ignored for BV packages.
        normalized_script_path = ""
        return {"package_id": pkg.id, "entrypoint_name": entrypoint_name, "script_path": normalized_script_path, "type": _process_type_from_package(pkg)}

    # Legacy behavior
    if entrypoint_name:
        raise HTTPException(status_code=400, detail="entrypoint_name must be null for legacy (non-bvpackage) processes")
    if not script_path:
        raise HTTPException(status_code=400, detail="Script path is required for legacy (non-bvpackage) processes")
    if pkg and bool(getattr(pkg, "is_bvpackage", False)):
        # Safety net: should have been caught above.
        raise HTTPException(status_code=400, detail="BV package processes must use entrypoint_name")
    return {"package_id": pkg.id if pkg else None, "entrypoint_name": None, "script_path": script_path, "type": _process_type_from_package(pkg)}


@router.get("/", dependencies=[Depends(get_current_user), Depends(require_permission("processes", "view"))])
def list_processes(search: Optional[str] = None, session=Depends(get_session)):
    stmt = select(Process)
    processes = session.exec(stmt).all()
    if search:
        s = search.lower()
        processes = [p for p in processes if s in p.name.lower() or (p.description and s in p.description.lower())]
    processes.sort(key=lambda p: (p.name or "").lower())
    return [process_to_out(p, session) for p in processes]


def _get_process_by_external_id(session, external_id: str) -> Process:
    """Resolve process by external_id only; reject numeric IDs at the boundary."""
    try:
        int(external_id)
    except Exception:
        pass
    else:
        raise HTTPException(status_code=400, detail="Process identifiers must be external_id (GUID)")

    p = session.exec(select(Process).where(Process.external_id == external_id)).first()
    if not p:
        raise HTTPException(status_code=404, detail="Process not found")
    return p


@router.get("/{process_identifier}", dependencies=[Depends(get_current_user), Depends(require_permission("processes", "view"))])
def get_process(process_identifier: str, session=Depends(get_session)):
    p = _get_process_by_external_id(session, process_identifier)
    return process_to_out(p, session)


@router.post("/", status_code=201, dependencies=[Depends(get_current_user), Depends(require_permission("processes", "create"))])
def create_process(payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if session.exec(select(Process).where(Process.name == name)).first():
        raise HTTPException(status_code=400, detail="A process with this name already exists")

    normalized = _validate_process_payload(session, payload)

    p = Process(
        name=name,
        description=payload.get("description") or None,
        package_id=normalized["package_id"],
        entrypoint_name=normalized["entrypoint_name"],
        script_path=normalized["script_path"],
        type=normalized.get("type") or "rpa",
        version=1,
        created_at=now_iso(),
        updated_at=now_iso(),
    )
    session.add(p)
    session.commit()
    session.refresh(p)
    _recompute_package_active(session, p.package_id)
    out = process_to_out(p, session)
    try:
        log_event(session, action="process.create", entity_type="process", entity_id=p.id, entity_name=p.name, before=None, after=out, metadata=None, request=request, user=user)
    except Exception:
        pass
    return out


@router.put("/{process_identifier}", dependencies=[Depends(get_current_user), Depends(require_permission("processes", "edit"))])
def update_process(process_identifier: str, payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    p = _get_process_by_external_id(session, process_identifier)
    before_out = process_to_out(p, session)
    old_package_id = p.package_id

    definition_changed = False

    if "name" in payload and (payload.get("name") or "").strip():
        new_name = payload["name"].strip()
        if new_name != p.name:
            if session.exec(select(Process).where(Process.name == new_name)).first():
                raise HTTPException(status_code=400, detail="A process with this name already exists")
            p.name = new_name
            definition_changed = True

    if "description" in payload:
        desc = payload.get("description")
        if desc != p.description:
            p.description = desc or None
            definition_changed = True

    if "package_id" in payload:
        new_pkg_id = payload.get("package_id")
        if new_pkg_id != p.package_id:
            p.package_id = new_pkg_id
            definition_changed = True

    if "entrypoint_name" in payload:
        new_ep = (payload.get("entrypoint_name") or "").strip() or None
        if new_ep != getattr(p, "entrypoint_name", None):
            p.entrypoint_name = new_ep
            definition_changed = True

    if "script_path" in payload and (payload.get("script_path") or "").strip():
        new_sp = payload["script_path"].strip()
        if new_sp != p.script_path:
            p.script_path = new_sp
            definition_changed = True

    # Enforce bvpackage vs legacy combination rules after applying changes.
    # Use the same validation logic on the would-be state.
    effective_payload = {
        "package_id": p.package_id,
        "entrypoint_name": getattr(p, "entrypoint_name", None),
        "script_path": p.script_path,
    }
    normalized = _validate_process_payload(session, effective_payload)
    p.package_id = normalized["package_id"]
    p.entrypoint_name = normalized["entrypoint_name"]
    p.script_path = normalized["script_path"]
    p.type = normalized.get("type") or getattr(p, "type", "rpa") or "rpa"

    if definition_changed:
        p.version = int(p.version or 1) + 1

    p.updated_at = now_iso()
    session.add(p)
    session.commit()
    session.refresh(p)
    _recompute_package_active(session, old_package_id)
    _recompute_package_active(session, p.package_id)
    after_out = process_to_out(p, session)
    try:
        changes = diff_dicts(before_out, after_out)
        log_event(session, action="process.update", entity_type="process", entity_id=p.id, entity_name=p.name, before=before_out, after=after_out, metadata={"changed_keys": list(changes.keys()), "diff": changes}, request=request, user=user)
    except Exception:
        pass
    return after_out


@router.delete("/{process_id}", status_code=204, dependencies=[Depends(get_current_user), Depends(require_permission("processes", "delete"))])
def delete_process(process_id: int, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    p = session.exec(select(Process).where(Process.id == process_id)).first()
    if not p:
        raise HTTPException(status_code=404, detail="Process not found")
    before_out = process_to_out(p, session)
    pkg_id = p.package_id
    session.delete(p)
    session.commit()
    _recompute_package_active(session, pkg_id)
    try:
        log_event(session, action="process.delete", entity_type="process", entity_id=process_id, entity_name=before_out.get("name"), before=before_out, after=None, metadata=None, request=request, user=user)
    except Exception:
        pass
    return None


@router.post("/{process_id}/upgrade", dependencies=[Depends(get_current_user), Depends(require_permission("processes", "edit"))])
def upgrade_process_to_latest(process_id: int, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    p = session.exec(select(Process).where(Process.id == process_id)).first()
    if not p:
        raise HTTPException(status_code=404, detail="Process not found")
    if not p.package_id:
        raise HTTPException(status_code=400, detail="Process is not associated with a package")
    current_pkg = session.exec(select(Package).where(Package.id == p.package_id)).first()
    if not current_pkg:
        raise HTTPException(status_code=400, detail="Current package not found")

    latest_pkg = _latest_package_for_name(session, current_pkg.name)
    if not latest_pkg:
        raise HTTPException(status_code=400, detail="No package versions found for this name")
    if _parse_semver(latest_pkg.version) <= _parse_semver(current_pkg.version):
        raise HTTPException(status_code=400, detail="Process already on latest version")

    # Validate payload using existing rules to ensure entrypoint/script compatibility.
    payload = {
        "package_id": latest_pkg.id,
        "entrypoint_name": getattr(p, "entrypoint_name", None),
        "script_path": p.script_path,
    }
    normalized = _validate_process_payload(session, payload)
    p.package_id = normalized["package_id"]
    p.entrypoint_name = normalized["entrypoint_name"]
    p.script_path = normalized["script_path"]
    p.type = normalized.get("type") or getattr(p, "type", "rpa") or "rpa"
    p.version = int(p.version or 1) + 1
    p.updated_at = now_iso()
    session.add(p)
    session.commit()
    session.refresh(p)
    _recompute_package_active(session, p.package_id)
    after_out = process_to_out(p, session)
    try:
        log_event(session, action="process.upgrade", entity_type="process", entity_id=p.id, entity_name=p.name, before=None, after=after_out, metadata={"from_version": current_pkg.version, "to_version": latest_pkg.version}, request=request, user=user)
    except Exception:
        pass
    return after_out
