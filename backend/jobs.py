import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import select

from .db import get_session
from .auth import get_current_user
from .models import Job, Process, Robot, Package, QueueItem
from .audit_utils import log_event
from .permissions import require_permission

router = APIRouter(prefix="/jobs", tags=["jobs"])

def now_iso():
    return datetime.now().isoformat(timespec='seconds')


def _update_queue_items_for_job(session, job: Job, final_status: str):
    raw_ids = getattr(job, "queue_item_ids", None)
    if not raw_ids:
        return
    try:
        ids = json.loads(raw_ids) if isinstance(raw_ids, str) else list(raw_ids)
    except Exception:
        return
    target_status = "DONE" if final_status.lower() == "completed" else "FAILED"
    now = now_iso()
    for qid in ids:
        try:
            qi = session.exec(select(QueueItem).where(QueueItem.id == qid)).first()
        except Exception:
            continue
        if not qi:
            continue
        if qi.status and str(qi.status).upper() in ("DONE", "FAILED"):
            continue
        qi.status = target_status
        if qi.job_id is None:
            qi.job_id = job.id
        if target_status == "FAILED" and job.error_message and not qi.error_message:
            qi.error_message = job.error_message
        qi.updated_at = now
        session.add(qi)

def job_to_out(j: Job, session=None) -> dict:
    def parse_json(s: Optional[str]):
        if not s:
            return None
        try:
            return json.loads(s)
        except Exception:
            return None
    process_out = None
    robot_out = None
    if session is not None:
        if j.process_id:
            p = session.exec(select(Process).where(Process.id == j.process_id)).first()
            if p:
                process_out = {
                    "id": p.id,
                    "name": p.name,
                    "description": p.description,
                    "package_id": p.package_id,
                    "script_path": p.script_path,
                    "is_active": p.is_active,
                    "version": p.version,
                    "created_at": p.created_at,
                    "updated_at": p.updated_at,
                }
        if j.robot_id:
            r = session.exec(select(Robot).where(Robot.id == j.robot_id)).first()
            if r:
                robot_out = {
                    "id": r.id,
                    "name": r.name,
                    "status": r.status,
                    "machine_info": r.machine_info,
                    "last_heartbeat": r.last_heartbeat,
                    "current_job_id": r.current_job_id,
                    "created_at": r.created_at,
                    "updated_at": r.updated_at,
                }
    return {
        "id": j.id,
        "execution_id": getattr(j, "execution_id", None),
        "process_id": j.process_id,
        "package_id": j.package_id,
        "package_name": getattr(j, "package_name", None),
        "package_version": getattr(j, "package_version", None),
        "entrypoint_name": getattr(j, "entrypoint_name", None),
        "source": getattr(j, "source", None),
        "trigger_id": getattr(j, "trigger_id", None),
        "queue_item_ids": parse_json(getattr(j, "queue_item_ids", None)) or [],
        "robot_id": j.robot_id,
        "status": j.status,
        "parameters": parse_json(j.parameters),
        "result": parse_json(j.result),
        "error_message": j.error_message,
        "logs_path": j.logs_path,
        "created_at": j.created_at,
        "started_at": j.started_at,
        "finished_at": j.finished_at,
        "process": process_out,
        "robot": robot_out,
    }

@router.get("/", dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "view"))])
def list_jobs(status: Optional[str] = None, process_id: Optional[int] = None, robot_id: Optional[int] = None, session=Depends(get_session)):
    jobs = session.exec(select(Job)).all()
    if status:
        jobs = [j for j in jobs if j.status == status]
    if process_id:
        jobs = [j for j in jobs if j.process_id == process_id]
    if robot_id:
        jobs = [j for j in jobs if j.robot_id == robot_id]
    jobs.sort(key=lambda j: j.created_at or "", reverse=True)
    return [job_to_out(j, session) for j in jobs]

@router.get("/{job_id}", dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "view"))])
def get_job(job_id: int, session=Depends(get_session)):
    j = session.exec(select(Job).where(Job.id == job_id)).first()
    if not j:
        raise HTTPException(status_code=404, detail="Job not found")
    return job_to_out(j, session)

@router.post("/", status_code=201, dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "create"))])
def create_job(payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    pid = payload.get("process_id")
    if not pid:
        raise HTTPException(status_code=400, detail="process_id is required")
    p = session.exec(select(Process).where(Process.id == pid)).first()
    if not p:
        raise HTTPException(status_code=404, detail="Process not found")

    pkg = None
    if p.package_id is not None:
        pkg = session.exec(select(Package).where(Package.id == p.package_id)).first()
        if not pkg:
            raise HTTPException(status_code=400, detail="Process references a package that does not exist")

    entrypoint_snapshot = None
    if pkg and bool(getattr(pkg, "is_bvpackage", False)):
        ep = getattr(p, "entrypoint_name", None)
        if not ep:
            raise HTTPException(status_code=400, detail="Process is missing entrypoint_name for BV package execution")
        entrypoint_snapshot = ep
    rid = payload.get("robot_id")
    if rid is not None:
        r = session.exec(select(Robot).where(Robot.id == rid)).first()
        if not r:
            raise HTTPException(status_code=404, detail="Robot not found")
    params = payload.get("parameters")
    params_json = None
    if isinstance(params, dict):
        params_json = json.dumps(params)
    elif isinstance(params, str) and params.strip():
        # accept raw json text
        try:
            json.loads(params)
            params_json = params
        except Exception:
            raise HTTPException(status_code=400, detail="parameters must be JSON")
    source = payload.get("source") or "MANUAL"
    trigger_id = payload.get("trigger_id") or None
    queue_item_ids = None
    if "queue_item_ids" in payload and payload.get("queue_item_ids") is not None:
        qids = payload.get("queue_item_ids")
        if isinstance(qids, list):
            queue_item_ids = json.dumps(qids)
        elif isinstance(qids, str):
            try:
                parsed = json.loads(qids)
                if isinstance(parsed, list):
                    queue_item_ids = qids
            except Exception:
                raise HTTPException(status_code=400, detail="queue_item_ids must be JSON array")
        else:
            raise HTTPException(status_code=400, detail="queue_item_ids must be a list")
    j = Job(
        process_id=pid,
        package_id=p.package_id,
        package_name=(pkg.name if pkg else None),
        package_version=(pkg.version if pkg else None),
        entrypoint_name=entrypoint_snapshot,
        source=source,
        trigger_id=trigger_id,
        queue_item_ids=queue_item_ids,
        robot_id=rid,
        status="pending",
        parameters=params_json,
        created_at=now_iso(),
        started_at=None,
        finished_at=None,
    )
    session.add(j)
    session.commit()
    session.refresh(j)
    out = job_to_out(j, session)
    try:
        log_event(session, action="job.create", entity_type="job", entity_id=j.id, entity_name=str(j.id), before=None, after=out, metadata={"process_id": pid, "robot_id": rid}, request=request, user=user)
    except Exception:
        pass
    return out

@router.put("/{job_id}", dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "edit"))])
def update_job(job_id: int, payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    j = session.exec(select(Job).where(Job.id == job_id)).first()
    if not j:
        raise HTTPException(status_code=404, detail="Job not found")
    before_status = j.status
    final_status = None
    if "status" in payload and payload.get("status"):
        j.status = str(payload["status"]).strip()
        if j.status == "running" and not j.started_at:
            j.started_at = now_iso()
        if j.status in ("completed", "failed", "canceled"):
            j.finished_at = now_iso()
            if j.status in ("completed", "failed"):
                final_status = j.status
    if "robot_id" in payload:
        rid = payload.get("robot_id")
        if rid is not None:
            r = session.exec(select(Robot).where(Robot.id == rid)).first()
            if not r:
                raise HTTPException(status_code=404, detail="Robot not found")
        j.robot_id = rid
    if "result" in payload:
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
                    raise HTTPException(status_code=400, detail="result must be JSON")
    if "error_message" in payload:
        j.error_message = payload.get("error_message") or None
    if final_status:
        _update_queue_items_for_job(session, j, final_status)
    session.add(j)
    session.commit()
    session.refresh(j)
    out = job_to_out(j, session)
    try:
        if before_status != j.status:
            log_event(session, action="job.status_change", entity_type="job", entity_id=j.id, entity_name=str(j.id), before={"status": before_status}, after={"status": j.status}, metadata={"status_from": before_status, "status_to": j.status}, request=request, user=user)
        else:
            log_event(session, action="job.update", entity_type="job", entity_id=j.id, entity_name=str(j.id), before=None, after=out, metadata=None, request=request, user=user)
    except Exception:
        pass
    return out

@router.post("/{job_id}/cancel", dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "edit"))])
def cancel_job(job_id: int, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    j = session.exec(select(Job).where(Job.id == job_id)).first()
    if not j:
        raise HTTPException(status_code=404, detail="Job not found")
    if j.status in ("pending", "running"):
        before_status = j.status
        j.status = "canceled"
        j.finished_at = now_iso()
        session.add(j)
        session.commit()
    out = job_to_out(j, session)
    try:
        log_event(session, action="job.cancel", entity_type="job", entity_id=j.id, entity_name=str(j.id), before={"status": before_status}, after={"status": j.status}, metadata={"status_from": before_status, "status_to": j.status}, request=request, user=user)
    except Exception:
        pass
    return out
