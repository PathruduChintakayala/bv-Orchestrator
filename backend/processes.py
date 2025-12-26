from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import select

from .db import get_session
from .auth import get_current_user
from .models import Process, Package
from .permissions import require_permission
from .audit_utils import log_event, diff_dicts

router = APIRouter(prefix="/processes", tags=["processes"])


def now_iso():
    return datetime.now().isoformat(timespec='seconds')


def process_to_out(p: Process, session=None) -> dict:
    pkg_out = None
    if p.package_id and session is not None:
        pkg = session.exec(select(Package).where(Package.id == p.package_id)).first()
        if pkg:
            from .packages import to_out as pkg_to_out
            pkg_out = pkg_to_out(pkg)
    return {
        "id": p.id,
        "name": p.name,
        "description": p.description,
        "package_id": p.package_id,
        "script_path": p.script_path,
        "is_active": p.is_active,
        "version": p.version,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
        "package": pkg_out,
    }


@router.get("/", dependencies=[Depends(get_current_user), Depends(require_permission("processes", "view"))])
def list_processes(search: Optional[str] = None, active_only: Optional[bool] = None, session=Depends(get_session)):
    stmt = select(Process)
    processes = session.exec(stmt).all()
    if search:
        s = search.lower()
        processes = [p for p in processes if s in p.name.lower() or (p.description and s in p.description.lower())]
    if active_only:
        processes = [p for p in processes if p.is_active]
    processes.sort(key=lambda p: (p.name or "").lower())
    return [process_to_out(p, session) for p in processes]


@router.get("/{process_id}", dependencies=[Depends(get_current_user), Depends(require_permission("processes", "view"))])
def get_process(process_id: int, session=Depends(get_session)):
    p = session.exec(select(Process).where(Process.id == process_id)).first()
    if not p:
        raise HTTPException(status_code=404, detail="Process not found")
    return process_to_out(p, session)


@router.post("/", status_code=201, dependencies=[Depends(get_current_user), Depends(require_permission("processes", "create"))])
def create_process(payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    name = (payload.get("name") or "").strip()
    script_path = (payload.get("script_path") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if not script_path:
        raise HTTPException(status_code=400, detail="Script path is required")
    if session.exec(select(Process).where(Process.name == name)).first():
        raise HTTPException(status_code=400, detail="A process with this name already exists")

    p = Process(
        name=name,
        description=payload.get("description") or None,
        script_path=script_path,
        is_active=bool(payload.get("is_active", True)),
        version=1,
        created_at=now_iso(),
        updated_at=now_iso(),
    )
    session.add(p)
    session.commit()
    session.refresh(p)
    out = process_to_out(p)
    try:
        log_event(session, action="process.create", entity_type="process", entity_id=p.id, entity_name=p.name, before=None, after=out, metadata=None, request=request, user=user)
    except Exception:
        pass
    return out


@router.put("/{process_id}", dependencies=[Depends(get_current_user), Depends(require_permission("processes", "edit"))])
def update_process(process_id: int, payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    p = session.exec(select(Process).where(Process.id == process_id)).first()
    if not p:
        raise HTTPException(status_code=404, detail="Process not found")
    before_out = process_to_out(p, session)

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

    if "script_path" in payload and (payload.get("script_path") or "").strip():
        new_sp = payload["script_path"].strip()
        if new_sp != p.script_path:
            p.script_path = new_sp
            definition_changed = True

    if "is_active" in payload and payload.get("is_active") is not None:
        new_active = bool(payload["is_active"])
        if new_active != p.is_active:
            p.is_active = new_active
            definition_changed = True

    if definition_changed:
        p.version = int(p.version or 1) + 1

    p.updated_at = now_iso()
    session.add(p)
    session.commit()
    session.refresh(p)
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
    session.delete(p)
    session.commit()
    try:
        log_event(session, action="process.delete", entity_type="process", entity_id=process_id, entity_name=before_out.get("name"), before=before_out, after=None, metadata=None, request=request, user=user)
    except Exception:
        pass
    return None
