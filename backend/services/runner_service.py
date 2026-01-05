import hashlib
import json
import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any
from sqlmodel import Session, select
from backend.models import Machine, Robot, Job, Process, Package, Setting
from backend.repositories.machine_repository import MachineRepository
from backend.repositories.robot_repository import RobotRepository
from backend.repositories.job_repository import JobRepository
from backend.packages import ensure_package_metadata
from backend.audit_utils import log_event
from backend.notification_service import NotificationService

log = logging.getLogger("runner")

def now_iso():
    return datetime.now().isoformat(timespec='seconds')

def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

from backend.redis_client import redis_client

class RunnerService:
    HEARTBEAT_TIMEOUT_SETTING_KEY = "runner.heartbeat_timeout_seconds"
    HEARTBEAT_TIMEOUT_DEFAULT_SECONDS = 30
    ROBOT_PASSWORD_CACHE_PREFIX = "robot_password:"

    def __init__(self, session: Session):
        self.session = session
        self.machine_repo = MachineRepository(session)
        self.robot_repo = RobotRepository(session)
        self.job_repo = JobRepository(session)

    def store_robot_password(self, robot_id: int, password: str) -> None:
        key = f"{self.ROBOT_PASSWORD_CACHE_PREFIX}{robot_id}"
        redis_client.set(key, password, expire=3600)  # 1 hour expiry

    def get_robot_password(self, robot_id: int) -> Optional[str]:
        key = f"{self.ROBOT_PASSWORD_CACHE_PREFIX}{robot_id}"
        return redis_client.get(key)

    def clear_robot_password(self, robot_id: int) -> None:
        key = f"{self.ROBOT_PASSWORD_CACHE_PREFIX}{robot_id}"
        redis_client.delete(key)

    def connect_machine(self, payload: Dict[str, Any], request: Any) -> Dict[str, Any]:
        machine_key = payload.get("machine_key")
        machine_signature = payload.get("machine_signature")
        machine_name_in = (payload.get("machine_name") or "").strip() or None
        machine_info = payload.get("machine_info") or None

        machine = self.machine_repo.get_by_key(machine_key)
        if not machine:
            raise ValueError("Invalid machine_key")
        if machine.mode != "runner":
            raise ValueError("Machine is not in runner mode")
        
        if machine_name_in and machine.name.lower().strip() != machine_name_in.lower().strip():
            raise ValueError("machine_name does not match the provisioned machine")

        signature_hash = self._normalize_signature(machine_signature)
        if machine.signature_hash and machine.signature_hash != signature_hash:
            raise ValueError("machine_signature does not match the provisioned machine")
        
        if not machine.signature_hash:
            machine.signature_hash = signature_hash

        machine.status = "connected"
        machine.last_seen_at = now_iso()
        machine.updated_at = now_iso()
        self.machine_repo.update(machine)

        try:
            log_event(self.session, action="machine.connect", entity_type="machine", entity_id=machine.id, entity_name=machine.name, before=None, after={"status": machine.status, "last_seen_at": machine.last_seen_at, "machine_info": machine_info}, metadata=None, request=request, user=None)
        except Exception:
            pass

        return {
            "machine_id": machine.id,
            "status": machine.status,
            "last_seen_at": machine.last_seen_at,
            "heartbeat_timeout_seconds": self._resolve_heartbeat_timeout(),
        }

    def get_assigned_robots(self, machine_key: str, machine_signature: str) -> Dict[str, Any]:
        machine = self.machine_repo.get_by_key(machine_key)
        if not machine:
            raise ValueError("Invalid machine_key")
        
        signature_hash = self._normalize_signature(machine_signature)
        if machine.signature_hash and machine.signature_hash != signature_hash:
            raise ValueError("machine_signature mismatch")

        machine.status = "connected"
        machine.last_seen_at = now_iso()
        machine.updated_at = now_iso()
        self.machine_repo.update(machine)

        robots = self.robot_repo.get_by_machine_id(machine.id)
        robot_payloads = []
        now = now_iso()
        for r in robots:
            if not r.api_token:
                r.api_token = secrets.token_hex(32)
                r.updated_at = now
                self.robot_repo.update(r)
            
            # Include plain password from Redis cache if available
            plain_password = self.get_robot_password(r.id) if r.username and r.password_hash else None

            robot_payloads.append({
                "id": r.id,
                "name": r.name,
                "machine_id": r.machine_id,
                "status": r.status,
                "username": r.username,
                "password": plain_password,
                "last_heartbeat": r.last_heartbeat,
                "api_token": r.api_token,
            })

        return {
            "machine_id": machine.id,
            "robots": robot_payloads,
            "heartbeat_timeout_seconds": self._resolve_heartbeat_timeout(),
        }

    def heartbeat(self, current_robot: Robot, payload: Dict[str, Any], request: Any) -> Dict[str, Any]:
        if current_robot.machine_id is None:
            raise ValueError("Robot is not bound to a machine")
        
        machine = self.machine_repo.get_by_id(current_robot.machine_id)
        if not machine:
            raise ValueError("Bound machine not found")

        signature_hash = self._normalize_signature(payload.get("machine_signature"))
        if machine.signature_hash and machine.signature_hash != signature_hash:
            raise ValueError("machine_signature mismatch")

        now = now_iso()
        machine.status = "connected"
        machine.last_seen_at = now
        machine.updated_at = now
        current_robot.last_heartbeat = now
        current_robot.status = "connected"
        if payload.get("machine_info"):
            current_robot.machine_info = payload.get("machine_info")
        current_robot.updated_at = now
        
        self.session.add(current_robot)
        self.session.add(machine)
        self.session.commit()

        try:
            log_event(self.session, action="robot.status_change", entity_type="robot", entity_id=current_robot.id, entity_name=current_robot.name, before=None, after={"status": current_robot.status, "last_heartbeat": current_robot.last_heartbeat}, metadata=None, request=request, user=None)
        except Exception:
            pass
        return {"status": "ok"}

    def get_next_job(self, current_robot: Robot, payload: Dict[str, Any], request: Any) -> Dict[str, Any]:
        if current_robot.machine_id is None:
            raise ValueError("Robot is not bound to a machine")
        
        machine = self.machine_repo.get_by_id(current_robot.machine_id)
        if not machine:
            raise ValueError("Bound machine not found")

        signature_hash = self._normalize_signature(payload.get("machine_signature"))
        if machine.signature_hash and machine.signature_hash != signature_hash:
            raise ValueError("machine_signature mismatch")

        # Claim job logic
        candidates = self.job_repo.get_pending_jobs()
        job = None
        for j in candidates:
            if j.robot_id is None or j.robot_id == current_robot.id:
                job = j
                break
        
        if not job:
            machine.status = "connected"
            machine.last_seen_at = now_iso()
            self.machine_repo.update(machine)
            return {"job": None}

        job.status = "running"
        job.started_at = now_iso()
        job.machine_name = machine.name  # Snapshot machine name when job starts
        if job.robot_id is None:
            job.robot_id = current_robot.id
        current_robot.current_job_id = job.id
        current_robot.updated_at = now_iso()
        machine.status = "connected"
        machine.last_seen_at = now_iso()
        
        self.session.add(job)
        self.session.add(current_robot)
        self.session.add(machine)
        self.session.commit()
        self.session.refresh(job)

        out = self._job_for_runner(job)
        try:
            log_event(self.session, action="job.status_change", entity_type="job", entity_id=job.id, entity_name=str(job.id), before={"status": "pending"}, after={"status": "running"}, metadata={"picked_by": current_robot.name}, request=request, user=None)
        except Exception:
            pass
        return {"job": out}

    def update_job_status(self, current_robot: Robot, job_id: int, payload: Dict[str, Any], request: Any, background_tasks=None) -> Dict[str, Any]:
        status_in = (payload.get("status") or "").strip().lower()
        if status_in not in ("completed", "failed"):
            raise ValueError("status must be 'completed' or 'failed'")
        
        j = self.job_repo.get_by_id(job_id)
        if not j:
            raise ValueError("Job not found")
        if j.robot_id != current_robot.id:
            raise ValueError("Job not assigned to this robot")
        if j.status not in ("running", "pending"):
            raise ValueError(f"Cannot update job in status {j.status}")

        before_status = j.status
        j.status = status_in
        j.finished_at = now_iso()
        
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
                    j.result = json.dumps({"text": res})
        
        j.error_message = payload.get("error_message") or None
        logs = payload.get("logs")
        if logs:
            try:
                current = json.loads(j.result) if j.result else {}
            except Exception:
                current = {}
            current["logs"] = logs if isinstance(logs, str) else json.dumps(logs)
            j.result = json.dumps(current)

        current_robot.current_job_id = None
        current_robot.updated_at = now_iso()
        
        from backend.services.job_service import JobService
        job_service = JobService(self.session)
        job_service._update_queue_items_for_job(j, status_in, background_tasks)

        self.session.add(j)
        self.session.add(current_robot)
        self.session.commit()

        if status_in == "failed":
            try:
                NotificationService(self.session).notify_job_failed(j, background_tasks)
            except Exception:
                pass

        try:
            log_event(self.session, action="job.status_change", entity_type="job", entity_id=j.id, entity_name=str(j.id), before={"status": before_status}, after={"status": j.status}, metadata={"updated_by": current_robot.name}, request=request, user=None)
        except Exception:
            pass
        return {"status": "ok"}

    def tick(self):
        now_dt = datetime.now()
        changed = False
        now_str = now_iso()

        timeout_seconds = self._resolve_heartbeat_timeout()
        threshold = now_dt - timedelta(seconds=timeout_seconds)

        robots = self.session.exec(select(Robot)).all()
        machines = self.session.exec(select(Machine)).all()

        offline_robots = []

        for r in robots:
            hb = self._parse_iso_datetime(r.last_heartbeat)
            if hb is None or hb < threshold:
                if r.status != "disconnected":
                    r.status = "disconnected"
                    r.updated_at = now_str
                    self.session.add(r)
                    changed = True
                    offline_robots.append(r)

        for m in machines:
            seen = self._parse_iso_datetime(m.last_seen_at)
            if seen is None or seen < threshold:
                if m.status != "disconnected":
                    m.status = "disconnected"
                    m.updated_at = now_str
                    self.session.add(m)
                    changed = True

        if changed:
            self.session.commit()
            if offline_robots:
                try:
                    notifier = NotificationService(self.session)
                    for r in offline_robots:
                        notifier.notify_robot_offline(r)
                except Exception:
                    pass

    def _parse_iso_datetime(self, value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value)
        except Exception:
            return None

    def _normalize_signature(self, value: Optional[str]) -> str:
        if not value or not isinstance(value, str):
            raise ValueError("machine_signature is required")
        candidate = value.strip()
        lowered = candidate.lower()
        if len(lowered) == 64 and all(c in "0123456789abcdef" for c in lowered):
            return lowered
        canonical = " ".join(candidate.split()).lower()
        return _sha256_hex(canonical)

    def _resolve_heartbeat_timeout(self) -> int:
        setting = self.session.exec(select(Setting).where(Setting.key == self.HEARTBEAT_TIMEOUT_SETTING_KEY)).first()
        if setting:
            try:
                val = int(setting.value)
                if val > 0:
                    return val
            except Exception:
                pass
        return self.HEARTBEAT_TIMEOUT_DEFAULT_SECONDS

    def _job_for_runner(self, j: Job) -> Optional[dict]:
        proc = self.session.exec(select(Process).where(Process.id == j.process_id)).first() if j.process_id else None
        pkg = self.session.exec(select(Package).where(Package.id == j.package_id)).first() if j.package_id else None
        if pkg:
            try:
                pkg = ensure_package_metadata(pkg, self.session)
            except Exception:
                pass
        
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
                "name": getattr(j, "package_name", None) or pkg.name,
                "version": getattr(j, "package_version", None) or pkg.version,
                "hash": getattr(pkg, "hash", None),
                "size_bytes": getattr(pkg, "size_bytes", None),
                "download_url": f"/api/packages/{pkg.id}/download",
            } if pkg else None,
            "entrypoint_name": getattr(j, "entrypoint_name", None) or (getattr(proc, "entrypoint_name", None) if proc else None),
        }

