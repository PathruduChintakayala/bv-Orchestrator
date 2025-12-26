from datetime import datetime
import hashlib
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select

from .auth import get_current_user
from .db import get_session
from .models import Machine, Robot
from .audit_utils import log_event
from .permissions import require_permission

router = APIRouter(prefix="/machines", tags=["machines"])  # mounted under /api


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _robot_count(session: Session, machine_id: int) -> int:
    robots = session.exec(select(Robot).where(Robot.machine_id == machine_id)).all()
    return len(robots)


def _to_out(m: Machine, session: Session) -> dict:
    return {
        "id": m.id,
        "name": m.name,
        "mode": m.mode,
        "status": m.status,
        "created_at": m.created_at,
        "updated_at": m.updated_at,
        "last_seen_at": m.last_seen_at,
        "robot_count": _robot_count(session, int(m.id)),
        # machine_key is intentionally never returned here
    }


@router.get("", dependencies=[Depends(get_current_user), Depends(require_permission("machines", "view"))])
def list_machines(session: Session = Depends(get_session)):
    rows = session.exec(select(Machine)).all()
    rows.sort(key=lambda m: (m.name or "").lower())
    return [_to_out(m, session) for m in rows]


@router.get("/{machine_id}", dependencies=[Depends(get_current_user), Depends(require_permission("machines", "view"))])
def get_machine(machine_id: int, session: Session = Depends(get_session)):
    m = session.exec(select(Machine).where(Machine.id == machine_id)).first()
    if not m:
        raise HTTPException(status_code=404, detail="Machine not found")
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


@router.delete("/{machine_id}", status_code=204, dependencies=[Depends(get_current_user), Depends(require_permission("machines", "delete"))])
def delete_machine(machine_id: int, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    m = session.exec(select(Machine).where(Machine.id == machine_id)).first()
    if not m:
        raise HTTPException(status_code=404, detail="Machine not found")

    count = _robot_count(session, machine_id)
    if count > 0:
        raise HTTPException(status_code=400, detail="Machine cannot be deleted while robots exist")

    before = {"id": m.id, "name": m.name, "mode": m.mode}
    session.delete(m)
    session.commit()

    try:
        log_event(session, action="machine.delete", entity_type="machine", entity_id=machine_id, entity_name=before.get("name"), before=before, after=None, metadata=None, request=request, user=user)
    except Exception:
        pass

    return None
