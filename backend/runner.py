import asyncio
import hashlib
import json
import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlmodel import Session, select

from backend.db import get_session, engine
from backend.models import Machine, Robot, Job, Process, Package, QueueItem, Setting
from backend.packages import ensure_package_metadata
from backend.robot_dependencies import get_current_robot
from backend.audit_utils import log_event

router = APIRouter(prefix="/runner", tags=["runner"])  # mounted under /api
log = logging.getLogger("runner")

HEARTBEAT_TIMEOUT_SETTING_KEY = "runner.heartbeat_timeout_seconds"
HEARTBEAT_TIMEOUT_DEFAULT_SECONDS = 30
HEARTBEAT_CHECK_INTERVAL_SECONDS = 10


def now_iso():
    return datetime.now().isoformat(timespec='seconds')


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except Exception:
        return None


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _normalize_signature(value: Optional[str]) -> str:
    if not value or not isinstance(value, str):
        raise HTTPException(status_code=400, detail="machine_signature is required")
    candidate = value.strip()
    # Accept pre-hashed hex to avoid double hashing when the runner already hashed it.
    lowered = candidate.lower()
    if len(lowered) == 64 and all(c in "0123456789abcdef" for c in lowered):
        return lowered
    canonical = " ".join(candidate.split()).lower()
    return _sha256_hex(canonical)


def _resolve_heartbeat_timeout(session: Session) -> int:
    setting = session.exec(select(Setting).where(Setting.key == HEARTBEAT_TIMEOUT_SETTING_KEY)).first()
    if setting:
        try:
            val = int(setting.value)
            if val > 0:
                return val
        except Exception:
            pass
    return HEARTBEAT_TIMEOUT_DEFAULT_SECONDS


def _require_machine_for_key(session: Session, machine_key: Optional[str]) -> Machine:
    if not machine_key or not isinstance(machine_key, str):
        raise HTTPException(status_code=400, detail="machine_key is required")
    mk_hash = _sha256_hex(machine_key.strip())
    machine = session.exec(select(Machine).where(Machine.machine_key_hash == mk_hash)).first()
    if not machine:
        raise HTTPException(status_code=401, detail="Invalid machine_key")
    if machine.mode != "runner":
        raise HTTPException(status_code=403, detail="Machine is not in runner mode")
    return machine


def _job_for_runner(j: Job, session: Session) -> Optional[dict]:
    if not j:
        return None
    proc = session.exec(select(Process).where(Process.id == j.process_id)).first() if j.process_id else None
    pkg = session.exec(select(Package).where(Package.id == j.package_id)).first() if j.package_id else None
    if pkg:
        try:
            pkg = ensure_package_metadata(pkg, session)
        except Exception:
            pkg = pkg
    def parse_json(s: Optional[str]):
        if not s:
            return None
        try:
            return json.loads(s)
        except Exception:
            return None
    return {
        "id": j.id,
        "execution_id": getattr(j, "execution_id", None),
        "status": j.status,
        "parameters": parse_json(j.parameters) or {},
        "queue_item_ids": parse_json(getattr(j, "queue_item_ids", None)) or [],
        "process": {
            "id": proc.id,
            "name": proc.name,
            "script_path": proc.script_path,
            "entrypoint_name": getattr(proc, "entrypoint_name", None),
            "package_id": proc.package_id,
        } if proc else None,
        "package": {
            "id": pkg.id,
            # Prefer job snapshot values for reproducibility.
            "name": getattr(j, "package_name", None) or pkg.name,
            "version": getattr(j, "package_version", None) or pkg.version,
            "hash": getattr(pkg, "hash", None),
            "size_bytes": getattr(pkg, "size_bytes", None),
            "download_url": f"/api/packages/{pkg.id}/download",
        } if pkg else None,
        # Convenience snapshot field for runners that understand BV entrypoints.
        "entrypoint_name": getattr(j, "entrypoint_name", None) or (getattr(proc, "entrypoint_name", None) if proc else None),
    }


def _update_queue_items_for_job(session: Session, job: Job, final_status: str):
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


@router.post("/connect-machine")
def connect_machine(payload: dict, request: Request, session: Session = Depends(get_session)):
    machine_key = payload.get("machine_key")
    machine_signature = payload.get("machine_signature")
    machine_name = (payload.get("machine_name") or "").strip() or None
    machine_info = payload.get("machine_info") or None

    machine = _require_machine_for_key(session, machine_key)
    if machine_name and machine.name.lower().strip() != machine_name.lower().strip():
        raise HTTPException(status_code=403, detail="machine_name does not match the provisioned machine")

    signature_hash = _normalize_signature(machine_signature)
    if machine.signature_hash and machine.signature_hash != signature_hash:
        raise HTTPException(status_code=403, detail="machine_signature does not match the provisioned machine")
    if not machine.signature_hash:
        machine.signature_hash = signature_hash

    # Machine connect does not create robots; it only marks the machine as active.
    machine.status = "connected"
    machine.last_seen_at = now_iso()
    machine.updated_at = now_iso()
    session.add(machine)
    session.commit()
    session.refresh(machine)

    try:
        log_event(
            session,
            action="machine.connect",
            entity_type="machine",
            entity_id=machine.id,
            entity_name=machine.name,
            before=None,
            after={"status": machine.status, "last_seen_at": machine.last_seen_at, "machine_info": machine_info},
            metadata=None,
            request=request,
            user=None,
        )
    except Exception:
        pass

    return {
        "machine_id": machine.id,
        "status": machine.status,
        "last_seen_at": machine.last_seen_at,
        "heartbeat_timeout_seconds": _resolve_heartbeat_timeout(session),
    }


@router.get("/assigned-robots")
def assigned_robots(machine_key: str, machine_signature: str, session: Session = Depends(get_session)):
    machine = _require_machine_for_key(session, machine_key)
    signature_hash = _normalize_signature(machine_signature)
    if machine.signature_hash and machine.signature_hash != signature_hash:
        raise HTTPException(status_code=403, detail="machine_signature does not match the provisioned machine")
    if not machine.signature_hash:
        machine.signature_hash = signature_hash

    machine.status = "connected"
    machine.last_seen_at = now_iso()
    machine.updated_at = now_iso()
    session.add(machine)

    robots = session.exec(select(Robot).where(Robot.machine_id == machine.id)).all()
    robot_payloads = []
    now = now_iso()
    for r in robots:
        if not r.api_token:
            r.api_token = secrets.token_hex(32)
            r.updated_at = now
            session.add(r)
        robot_payloads.append(
            {
                "id": r.id,
                "name": r.name,
                "machine_id": r.machine_id,
                "status": r.status,
                "credential_asset_id": r.credential_asset_id,
                "last_heartbeat": r.last_heartbeat,
                "api_token": r.api_token,
            }
        )

    session.commit()

    return {
        "machine_id": machine.id,
        "robots": robot_payloads,
        "heartbeat_timeout_seconds": _resolve_heartbeat_timeout(session),
    }


@router.post("/register-robot")
def register_robot(payload: dict, request: Request, session: Session = Depends(get_session)):
    # Auto-registration is intentionally disabled; runners must use connect-machine + assigned-robots.
    raise HTTPException(status_code=410, detail="Robot auto-registration is disabled; use connect-machine and assigned-robots")


@router.post("/heartbeat")
def runner_heartbeat(payload: dict, request: Request, session: Session = Depends(get_session), current_robot: Robot = Depends(get_current_robot)):
    # Optional: validate body robot_id matches current_robot.id
    rid = payload.get("robot_id")
    if rid is not None and int(rid) != int(current_robot.id):
        raise HTTPException(status_code=400, detail="robot_id does not match token")
    if current_robot.machine_id is None:
        raise HTTPException(status_code=400, detail="Robot is not bound to a machine; re-register")
    machine = session.exec(select(Machine).where(Machine.id == int(current_robot.machine_id))).first()
    if not machine:
        raise HTTPException(status_code=400, detail="Bound machine not found; re-register")
    signature_hash = _normalize_signature(payload.get("machine_signature"))
    if machine.signature_hash and machine.signature_hash != signature_hash:
        raise HTTPException(status_code=403, detail="machine_signature mismatch")
    if not machine.signature_hash:
        machine.signature_hash = signature_hash
    now = now_iso()
    machine.status = "connected"
    machine.last_seen_at = now
    machine.updated_at = now
    current_robot.last_heartbeat = now
    current_robot.status = "connected"
    if payload.get("machine_info"):
        current_robot.machine_info = payload.get("machine_info")
    current_robot.updated_at = now
    session.add(current_robot)
    session.add(machine)
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
    if current_robot.machine_id is None:
        raise HTTPException(status_code=400, detail="Robot is not bound to a machine; re-register")
    machine = session.exec(select(Machine).where(Machine.id == int(current_robot.machine_id))).first()
    if not machine:
        raise HTTPException(status_code=400, detail="Bound machine not found; re-register")
    signature_hash = _normalize_signature(payload.get("machine_signature"))
    if machine.signature_hash and machine.signature_hash != signature_hash:
        raise HTTPException(status_code=403, detail="machine_signature mismatch")
    if not machine.signature_hash:
        machine.signature_hash = signature_hash
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
            machine.status = "connected"
            machine.last_seen_at = now_iso()
            machine.updated_at = now_iso()
            s.add(machine)
            s.commit()
            return {"job": None}
        # claim and set running
        job.status = "running"
        job.started_at = now_iso()
        if job.robot_id is None:
            job.robot_id = current_robot.id
        current_robot.current_job_id = job.id
        current_robot.updated_at = now_iso()
        machine.status = "connected"
        machine.last_seen_at = now_iso()
        machine.updated_at = now_iso()
        s.add(job)
        s.add(current_robot)
        s.add(machine)
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
    _update_queue_items_for_job(session, j, status_in)
    session.add(j)
    session.add(current_robot)
    session.commit()
    try:
        log_event(session, action="job.status_change", entity_type="job", entity_id=j.id, entity_name=str(j.id), before={"status": before_status}, after={"status": j.status}, metadata={"updated_by": current_robot.name}, request=request, user=None)
    except Exception:
        pass
    return {"status": "ok"}


class RobotHeartbeatMonitor:
    def __init__(self, db_engine, check_interval_seconds: int = HEARTBEAT_CHECK_INTERVAL_SECONDS, default_timeout_seconds: int = HEARTBEAT_TIMEOUT_DEFAULT_SECONDS):
        self.engine = db_engine
        self.check_interval = check_interval_seconds
        self.default_timeout = default_timeout_seconds
        self._task: Optional[asyncio.Task] = None
        self._stopped = False

    def start(self):
        if self._task and not self._task.done():
            return
        self._stopped = False
        self._task = asyncio.create_task(self._run(), name="robot-heartbeat-monitor")

    async def stop(self):
        self._stopped = True
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except Exception:
                pass

    async def _run(self):
        while not self._stopped:
            try:
                self._tick()
            except Exception as exc:
                log.exception("Heartbeat monitor tick failed: %s", exc)
            await asyncio.sleep(self.check_interval)

    def _tick(self):
        now_dt = datetime.now()
        changed = False
        now_str = now_iso()

        with Session(self.engine) as session:
            try:
                timeout_seconds = int(_resolve_heartbeat_timeout(session))
            except Exception:
                timeout_seconds = self.default_timeout
            timeout_seconds = timeout_seconds if timeout_seconds > 0 else self.default_timeout
            threshold = now_dt - timedelta(seconds=timeout_seconds)

            robots = session.exec(select(Robot)).all()
            machines = session.exec(select(Machine)).all()

            for r in robots:
                hb = _parse_iso_datetime(r.last_heartbeat)
                if hb is None or hb < threshold:
                    if r.status != "disconnected":
                        r.status = "disconnected"
                        r.updated_at = now_str
                        session.add(r)
                        changed = True

            for m in machines:
                seen = _parse_iso_datetime(m.last_seen_at)
                if seen is None or seen < threshold:
                    if m.status != "disconnected":
                        m.status = "disconnected"
                        m.updated_at = now_str
                        session.add(m)
                        changed = True

            if changed:
                session.commit()


heartbeat_monitor = RobotHeartbeatMonitor(engine)
