import json
import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlmodel import Session, select

from .db import get_session
from .models import Robot, Job, Process, Package
from .robot_dependencies import get_current_robot
from .audit_utils import log_event

router = APIRouter(prefix="/runner", tags=["runner"])  # mounted under /api


def now_iso():
    return datetime.now().isoformat(timespec='seconds')


def _job_for_runner(j: Job, session: Session) -> Optional[dict]:
    if not j:
        return None
    proc = session.exec(select(Process).where(Process.id == j.process_id)).first() if j.process_id else None
    pkg = session.exec(select(Package).where(Package.id == j.package_id)).first() if j.package_id else None
    def parse_json(s: Optional[str]):
        if not s:
            return None
        try:
            return json.loads(s)
        except Exception:
            return None
    return {
        "id": j.id,
        "status": j.status,
        "parameters": parse_json(j.parameters) or {},
        "process": {
            "id": proc.id,
            "name": proc.name,
            "script_path": proc.script_path,
            "package_id": proc.package_id,
        } if proc else None,
        "package": {
            "id": pkg.id,
            "name": pkg.name,
            "version": pkg.version,
        } if pkg else None,
    }


@router.post("/register-robot")
def register_robot(payload: dict, request: Request, session: Session = Depends(get_session)):
    name = (payload.get("name") or "").strip()
    machine_info = payload.get("machine_info") or None
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    r = session.exec(select(Robot).where(Robot.name == name)).first()
    if r:
        # ensure token exists
        if not r.api_token:
            r.api_token = secrets.token_hex(32)
        r.status = "online"
        r.machine_info = machine_info or r.machine_info
        r.last_heartbeat = now_iso()
        r.updated_at = now_iso()
        session.add(r)
        session.commit()
        session.refresh(r)
    else:
        r = Robot(
            name=name,
            status="online",
            machine_info=machine_info,
            api_token=secrets.token_hex(32),
            last_heartbeat=now_iso(),
            created_at=now_iso(),
            updated_at=now_iso(),
        )
        session.add(r)
        session.commit()
        session.refresh(r)
        try:
            log_event(session, action="robot.register", entity_type="robot", entity_id=r.id, entity_name=r.name, before=None, after={"name": r.name, "status": r.status}, metadata=None, request=request, user=None)
        except Exception:
            pass
    return {"robot_id": r.id, "api_token": r.api_token, "name": r.name}


@router.post("/heartbeat")
def runner_heartbeat(payload: dict, request: Request, session: Session = Depends(get_session), current_robot: Robot = Depends(get_current_robot)):
    # Optional: validate body robot_id matches current_robot.id
    rid = payload.get("robot_id")
    if rid is not None and int(rid) != int(current_robot.id):
        raise HTTPException(status_code=400, detail="robot_id does not match token")
    current_robot.last_heartbeat = now_iso()
    current_robot.status = "online"
    if payload.get("machine_info"):
        current_robot.machine_info = payload.get("machine_info")
    current_robot.updated_at = now_iso()
    session.add(current_robot)
    session.commit()
    try:
        log_event(session, action="robot.status_change", entity_type="robot", entity_id=current_robot.id, entity_name=current_robot.name, before=None, after={"status": current_robot.status, "last_heartbeat": current_robot.last_heartbeat}, metadata=None, request=request, user=None)
    except Exception:
        pass
    return {"status": "ok"}


@router.post("/next-job")
def next_job(payload: dict, request: Request, session: Session = Depends(get_session), current_robot: Robot = Depends(get_current_robot)):
    rid = payload.get("robot_id")
    if rid is not None and int(rid) != int(current_robot.id):
        raise HTTPException(status_code=400, detail="robot_id does not match token")
    # Single-transaction claim
    with session as s:
        # find pending job for this robot or unassigned
        candidates = s.exec(
            select(Job).where(Job.status == "pending").order_by(Job.created_at)
        ).all()
        job = None
        for j in candidates:
            if j.robot_id is None or j.robot_id == current_robot.id:
                job = j
                break
        if not job:
            return {"job": None}
        # claim and set running
        job.status = "running"
        job.started_at = now_iso()
        if job.robot_id is None:
            job.robot_id = current_robot.id
        current_robot.current_job_id = job.id
        current_robot.updated_at = now_iso()
        s.add(job)
        s.add(current_robot)
        s.commit()
        s.refresh(job)
    out = _job_for_runner(job, session)
    try:
        log_event(session, action="job.status_change", entity_type="job", entity_id=job.id, entity_name=str(job.id), before={"status": "pending"}, after={"status": "running"}, metadata={"picked_by": current_robot.name}, request=request, user=None)
    except Exception:
        pass
    return {"job": out}


@router.post("/jobs/{job_id}/update")
def update_job_status(job_id: int, payload: dict, request: Request, session: Session = Depends(get_session), current_robot: Robot = Depends(get_current_robot)):
    status_in = (payload.get("status") or "").strip().lower()
    if status_in not in ("completed", "failed"):
        raise HTTPException(status_code=400, detail="status must be 'completed' or 'failed'")
    j = session.exec(select(Job).where(Job.id == job_id)).first()
    if not j:
        raise HTTPException(status_code=404, detail="Job not found")
    if j.robot_id != current_robot.id:
        raise HTTPException(status_code=403, detail="Job not assigned to this robot")
    if j.status not in ("running", "pending"):
        raise HTTPException(status_code=400, detail=f"Cannot update job in status {j.status}")
    before_status = j.status
    j.status = status_in
    j.finished_at = now_iso()
    # result
    res = payload.get("result")
    if res is None:
        j.result = None
    else:
        if isinstance(res, dict):
            j.result = json.dumps(res)
        elif isinstance(res, str):
            try:
                json.loads(res)
                j.result = res
            except Exception:
                # store as string under a wrapper
                j.result = json.dumps({"text": res})
    # error message
    j.error_message = payload.get("error_message") or None
    # optional logs: store in result bundle to keep schema minimal
    logs = payload.get("logs")
    if logs:
        try:
            current = json.loads(j.result) if j.result else {}
        except Exception:
            current = {}
        current["logs"] = logs if isinstance(logs, str) else json.dumps(logs)
        j.result = json.dumps(current)
    # clear robot's current job
    current_robot.current_job_id = None
    current_robot.updated_at = now_iso()
    session.add(j)
    session.add(current_robot)
    session.commit()
    try:
        log_event(session, action="job.status_change", entity_type="job", entity_id=j.id, entity_name=str(j.id), before={"status": before_status}, after={"status": j.status}, metadata={"updated_by": current_robot.name}, request=request, user=None)
    except Exception:
        pass
    return {"status": "ok"}
