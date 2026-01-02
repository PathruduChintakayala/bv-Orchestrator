from datetime import datetime
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import select

from backend.db import get_session
from backend.auth import get_current_user
from backend.models import Robot, Job, Machine
from backend.audit_utils import log_event, diff_dicts
from backend.permissions import require_permission

router = APIRouter(prefix="/robots", tags=["robots"])


def _validate_provisioning_credentials(*, machine: Optional[Machine], username: str, password: str):
    """Validate host credentials for provisioning without persisting them.

    This intentionally performs validation up front and discards credentials immediately
    after use to avoid leaking them into Assets or logs.
    """
    if machine is None:
        raise HTTPException(status_code=400, detail="A machine is required when supplying credentials")
    if machine.mode != "runner":
        raise HTTPException(status_code=400, detail="Credentials can only be validated against runner machines")
    if not machine.status or machine.status.lower() != "connected":
        raise HTTPException(status_code=400, detail="Machine must be connected to validate credentials")
    # Placeholder for real host authentication. We deliberately avoid logging secrets.
    if not username or not password:
        raise HTTPException(status_code=400, detail="credential.username and credential.password are required")
    # Future enhancement: perform an actual auth handshake against the runner/host here.
    return True

def now_iso():
    return datetime.now().isoformat(timespec='seconds')

def to_out(r: Robot, session) -> dict:
    machine_name = None
    if r.machine_id:
        m = session.exec(select(Machine).where(Machine.id == r.machine_id)).first()
        machine_name = m.name if m else None
    return {
        "id": r.id,
        "name": r.name,
        "status": r.status,
        "machine_id": r.machine_id,
        "machine_name": machine_name,
        "machine_info": r.machine_info,
        "credential_asset_id": r.credential_asset_id,
        "last_heartbeat": r.last_heartbeat,
        "current_job_id": r.current_job_id,
        "created_at": r.created_at,
        "updated_at": r.updated_at,
    }

@router.get("/", dependencies=[Depends(get_current_user), Depends(require_permission("robots", "view"))])
def list_robots(search: Optional[str] = None, status: Optional[str] = None, session=Depends(get_session)):
    robots = session.exec(select(Robot)).all()
    if search:
        s = search.lower()
        robots = [r for r in robots if s in r.name.lower()]
    if status:
        normalized = status.lower()
        targets = [normalized]
        if normalized == "online":
            targets.append("connected")
        elif normalized == "offline":
            targets.append("disconnected")
        robots = [r for r in robots if (r.status or "").lower() in targets]
    robots.sort(key=lambda r: r.name.lower())
    return [to_out(r, session) for r in robots]

@router.get("/{robot_id}", dependencies=[Depends(get_current_user), Depends(require_permission("robots", "view"))])
def get_robot(robot_id: int, session=Depends(get_session)):
    r = session.exec(select(Robot).where(Robot.id == robot_id)).first()
    if not r:
        raise HTTPException(status_code=404, detail="Robot not found")
    return to_out(r, session)

@router.post("/", status_code=201, dependencies=[Depends(get_current_user), Depends(require_permission("robots", "create"))])
def create_robot(payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if session.exec(select(Robot).where(Robot.name == name)).first():
        raise HTTPException(status_code=400, detail="A robot with this name already exists")

    machine_id = payload.get("machine_id")
    if machine_id is not None:
        m = session.exec(select(Machine).where(Machine.id == int(machine_id))).first()
        if not m:
            raise HTTPException(status_code=400, detail="Selected machine does not exist")
        if m.mode != "runner":
            raise HTTPException(status_code=400, detail="Selected machine is not in runner mode")

    credential_asset_id = None
    cred = payload.get("credential")
    if isinstance(cred, dict):
        username = (cred.get("username") or "").strip()
        password = (cred.get("password") or "").strip()
        if not username or not password:
            raise HTTPException(status_code=400, detail="credential.username and credential.password are required")
        if machine_id is None or not m:
            raise HTTPException(status_code=400, detail="A machine is required when supplying credentials")
        _validate_provisioning_credentials(machine=m, username=username, password=password)

    r = Robot(
        name=name,
        status="disconnected",
        machine_id=int(machine_id) if machine_id is not None else None,
        machine_info=payload.get("machine_info") or None,
        credential_asset_id=credential_asset_id,
        api_token=secrets.token_hex(16),
        last_heartbeat=None,
        created_at=now_iso(),
        updated_at=now_iso(),
    )
    session.add(r)
    session.commit()
    session.refresh(r)
    out = to_out(r, session)
    try:
        log_event(session, action="robot.create", entity_type="robot", entity_id=r.id, entity_name=r.name, before=None, after=out, metadata=None, request=request, user=user)
    except Exception:
        pass
    return out

@router.put("/{robot_id}", dependencies=[Depends(get_current_user), Depends(require_permission("robots", "edit"))])
def update_robot(robot_id: int, payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    r = session.exec(select(Robot).where(Robot.id == robot_id)).first()
    if not r:
        raise HTTPException(status_code=404, detail="Robot not found")
    before_out = to_out(r, session)
    if "status" in payload:
        raise HTTPException(status_code=400, detail="Robot status is managed by runner heartbeat")
    if "machine_info" in payload:
        r.machine_info = payload.get("machine_info") or None
    if "machine_id" in payload:
        mid = payload.get("machine_id")
        if mid is None or mid == "":
            r.machine_id = None
        else:
            m = session.exec(select(Machine).where(Machine.id == int(mid))).first()
            if not m:
                raise HTTPException(status_code=400, detail="Selected machine does not exist")
            if m.mode != "runner":
                raise HTTPException(status_code=400, detail="Selected machine is not in runner mode")
            r.machine_id = int(mid)
    r.updated_at = now_iso()
    session.add(r)
    session.commit()
    session.refresh(r)
    after_out = to_out(r, session)
    try:
        action = "robot.status_change" if before_out.get("status") != after_out.get("status") else "robot.update"
        log_event(session, action=action, entity_type="robot", entity_id=r.id, entity_name=r.name, before=before_out, after=after_out, metadata=None, request=request, user=user)
    except Exception:
        pass
    return after_out

@router.delete("/{robot_id}", status_code=204, dependencies=[Depends(get_current_user), Depends(require_permission("robots", "delete"))])
def delete_robot(robot_id: int, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    r = session.exec(select(Robot).where(Robot.id == robot_id)).first()
    if not r:
        raise HTTPException(status_code=404, detail="Robot not found")
    before_out = to_out(r, session)
    session.delete(r)
    session.commit()
    try:
        log_event(session, action="robot.delete", entity_type="robot", entity_id=robot_id, entity_name=before_out.get("name"), before=before_out, after=None, metadata=None, request=request, user=user)
    except Exception:
        pass
    return None

@router.post("/{robot_id}/heartbeat", dependencies=[Depends(get_current_user), Depends(require_permission("robots", "edit"))])
def robot_heartbeat(robot_id: int, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    r = session.exec(select(Robot).where(Robot.id == robot_id)).first()
    if not r:
        raise HTTPException(status_code=404, detail="Robot not found")
    r.last_heartbeat = now_iso()
    r.status = "connected"
    r.updated_at = now_iso()
    session.add(r)
    session.commit()
    try:
        log_event(session, action="robot.status_change", entity_type="robot", entity_id=r.id, entity_name=r.name, before=None, after={"status": r.status, "last_heartbeat": r.last_heartbeat}, metadata=None, request=request, user=user)
    except Exception:
        pass
    return {"status": "ok"}
