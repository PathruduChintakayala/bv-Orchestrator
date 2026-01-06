from datetime import datetime
import hashlib
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select

from backend.auth import get_current_user
from backend.db import get_session
from backend.models import Machine, Robot
from backend.audit_utils import log_event
from backend.permissions import require_permission

router = APIRouter(prefix="/machines", tags=["machines"])  # mounted under /api


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _robot_count(session: Session, machine_id: int) -> int:
    robots = session.exec(select(Robot).where(Robot.machine_id == machine_id)).all()
    return len(robots)


def _to_out(m: Machine, session: Session) -> dict:
    return {
        "id": getattr(m, "external_id", None) or str(m.id),
        "_internal_id": m.id,  # deprecated: prefer id (external_id)
        "name": m.name,
        "mode": m.mode,
        "status": m.status,
        "created_at": m.created_at,
        "updated_at": m.updated_at,
        "last_seen_at": m.last_seen_at,
        "robot_count": _robot_count(session, int(m.id)),
        # machine_key is intentionally never returned here
    }


def _get_machine_by_external_id(session: Session, external_id: str) -> Machine:
    """Resolve machine by external_id (public GUID). Numeric IDs are rejected for management routes."""
    try:
        int(external_id)
        raise HTTPException(status_code=400, detail="Machine identifiers must be external_id (GUID)")
    except ValueError:
        pass
    m = session.exec(select(Machine).where(Machine.external_id == external_id)).first()
    if not m:
        raise HTTPException(status_code=404, detail="Machine not found")
    return m


@router.get("", dependencies=[Depends(get_current_user), Depends(require_permission("machines", "view"))])
def list_machines(session: Session = Depends(get_session)):
    rows = session.exec(select(Machine)).all()
    rows.sort(key=lambda m: (m.name or "").lower())
    return [_to_out(m, session) for m in rows]


@router.get("/{machine_external_id}", dependencies=[Depends(get_current_user), Depends(require_permission("machines", "view"))])
def get_machine(machine_external_id: str, session: Session = Depends(get_session)):
    m = _get_machine_by_external_id(session, machine_external_id)
    return _to_out(m, session)


@router.post("", status_code=201, dependencies=[Depends(get_current_user), Depends(require_permission("machines", "create"))])
def create_machine(payload: dict, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    name = (payload.get("name") or "").strip()
    mode = (payload.get("mode") or "").strip().lower()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if mode not in ("dev", "runner"):
        raise HTTPException(status_code=400, detail="mode must be 'dev' or 'runner'")
    if session.exec(select(Machine).where(Machine.name == name)).first():
        raise HTTPException(status_code=400, detail="A machine with this name already exists")

    machine_key: Optional[str] = None
    machine_key_hash: Optional[str] = None
    if mode == "runner":
        machine_key = secrets.token_urlsafe(24)
        machine_key_hash = hashlib.sha256(machine_key.encode("utf-8")).hexdigest()

    m = Machine(
        name=name,
        mode=mode,
        status="disconnected",
        created_at=now_iso(),
        updated_at=now_iso(),
        last_seen_at=None,
        machine_key_hash=machine_key_hash,
    )
    session.add(m)
    session.commit()
    session.refresh(m)

    out = _to_out(m, session)
    # only return machine_key at creation time
    if machine_key:
        out["machine_key"] = machine_key

    try:
        log_event(session, action="machine.create", entity_type="machine", entity_id=m.id, entity_name=m.name, before=None, after=out, metadata={"mode": mode}, request=request, user=user)
    except Exception:
        pass

    return out


@router.delete("/{machine_external_id}", status_code=204, dependencies=[Depends(get_current_user), Depends(require_permission("machines", "delete"))])
def delete_machine(machine_external_id: str, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    m = _get_machine_by_external_id(session, machine_external_id)

    count = _robot_count(session, m.id)
    if count > 0:
        raise HTTPException(status_code=400, detail="Machine cannot be deleted while robots exist")

    before = {"id": m.id, "name": m.name, "mode": m.mode}
    session.delete(m)
    session.commit()

    try:
        log_event(session, action="machine.delete", entity_type="machine", entity_id=m.id, entity_name=before.get("name"), before=before, after=None, metadata=None, request=request, user=user)
    except Exception:
        pass

    return None


@router.post("/{machine_external_id}/regenerate-key", dependencies=[Depends(get_current_user), Depends(require_permission("machines", "update"))])
def regenerate_machine_key(machine_external_id: str, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    m = _get_machine_by_external_id(session, machine_external_id)
    if m.mode != "runner":
        raise HTTPException(status_code=400, detail="Only runner machines have keys")

    # Generate new key
    machine_key = secrets.token_urlsafe(24)
    machine_key_hash = hashlib.sha256(machine_key.encode("utf-8")).hexdigest()

    before = {"id": m.id, "name": m.name, "machine_key_hash": m.machine_key_hash}
    m.machine_key_hash = machine_key_hash
    m.updated_at = now_iso()
    session.commit()

    try:
        log_event(session, action="machine.regenerate_key", entity_type="machine", entity_id=m.id, entity_name=m.name, before=before, after={"machine_key_hash": machine_key_hash}, metadata=None, request=request, user=user)
    except Exception:
        pass

    return {"machine_key": machine_key}
