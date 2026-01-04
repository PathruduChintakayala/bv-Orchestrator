import json
from datetime import datetime
from typing import Optional, List, Dict, Any
from sqlmodel import Session, select
from backend.models import Job, Process, Robot, Package, QueueItem, Machine
from backend.repositories.job_repository import JobRepository
from backend.audit_utils import log_event

def now_iso():
    return datetime.now().isoformat(timespec='seconds')

class JobService:
    def __init__(self, session: Session):
        self.session = session
        self.repo = JobRepository(session)

    def list_jobs(self, status: Optional[str] = None, process_id: Optional[int] = None, robot_id: Optional[int] = None) -> List[Dict[str, Any]]:
        jobs = self.repo.get_jobs(status, process_id, robot_id)
        return [self.job_to_out(j) for j in jobs]

    def get_job(self, job_id: int) -> Optional[Dict[str, Any]]:
        j = self.repo.get_by_id(job_id)
        if not j:
            return None
        return self.job_to_out(j)

    def create_job(self, payload: Dict[str, Any], user: Any, request: Any) -> Dict[str, Any]:
        pid = payload.get("process_id")
        p = self.session.exec(select(Process).where(Process.id == pid)).first()
        if not p:
            raise ValueError("Process not found")

        pkg = None
        if p.package_id is not None:
            pkg = self.session.exec(select(Package).where(Package.id == p.package_id)).first()
            if not pkg:
                raise ValueError("Process references a package that does not exist")

        entrypoint_snapshot = None
        if pkg and bool(getattr(pkg, "is_bvpackage", False)):
            ep = getattr(p, "entrypoint_name", None)
            if not ep:
                raise ValueError("Process is missing entrypoint_name for BV package execution")
            entrypoint_snapshot = ep

        rid = payload.get("robot_id")
        machine_name = None
        if rid is not None:
            r = self.session.exec(select(Robot).where(Robot.id == rid)).first()
            if not r:
                raise ValueError("Robot not found")
            # If robot has a machine, set machine_name for better UX (will be updated when job starts)
            if r.machine_id:
                from backend.models import Machine
                m = self.session.exec(select(Machine).where(Machine.id == r.machine_id)).first()
                if m:
                    machine_name = m.name

        params = payload.get("parameters")
        params_json = None
        if isinstance(params, dict):
            params_json = json.dumps(params)
        elif isinstance(params, str) and params.strip():
            try:
                json.loads(params)
                params_json = params
            except Exception:
                raise ValueError("parameters must be JSON")

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
                    raise ValueError("queue_item_ids must be JSON array")
            else:
                raise ValueError("queue_item_ids must be a list")

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
            machine_name=machine_name,  # Set if robot has a machine (will be updated when job starts)
            status="pending",
            parameters=params_json,
            created_at=now_iso(),
            started_at=None,
            finished_at=None,
        )
        self.repo.create(j)
        out = self.job_to_out(j)
        try:
            log_event(self.session, action="job.create", entity_type="job", entity_id=j.id, entity_name=str(j.id), before=None, after=out, metadata={"process_id": pid, "robot_id": rid}, request=request, user=user)
        except Exception:
            pass
        return out

    def update_job(self, job_id: int, payload: Dict[str, Any], user: Any, request: Any) -> Dict[str, Any]:
        j = self.repo.get_by_id(job_id)
        if not j:
            raise ValueError("Job not found")
        
        before_status = j.status
        final_status = None
        if "status" in payload and payload.get("status"):
            j.status = str(payload["status"]).strip()
            if j.status == "running" and not j.started_at:
                j.started_at = now_iso()
                # Set machine_name when job starts running (if not already set)
                if not j.machine_name and j.robot_id:
                    from backend.models import Machine
                    r = self.session.exec(select(Robot).where(Robot.id == j.robot_id)).first()
                    if r and r.machine_id:
                        m = self.session.exec(select(Machine).where(Machine.id == r.machine_id)).first()
                        if m:
                            j.machine_name = m.name
            if j.status in ("completed", "failed", "canceled"):
                j.finished_at = now_iso()
                if j.status in ("completed", "failed"):
                    final_status = j.status

        if "robot_id" in payload:
            rid = payload.get("robot_id")
            if rid is not None:
                r = self.session.exec(select(Robot).where(Robot.id == rid)).first()
                if not r:
                    raise ValueError("Robot not found")
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
                        raise ValueError("result must be JSON")

        if "error_message" in payload:
            j.error_message = payload.get("error_message") or None

        if final_status:
            self._update_queue_items_for_job(j, final_status)

        self.repo.update(j)
        out = self.job_to_out(j)
        try:
            if before_status != j.status:
                log_event(self.session, action="job.status_change", entity_type="job", entity_id=j.id, entity_name=str(j.id), before={"status": before_status}, after={"status": j.status}, metadata={"status_from": before_status, "status_to": j.status}, request=request, user=user)
            else:
                log_event(self.session, action="job.update", entity_type="job", entity_id=j.id, entity_name=str(j.id), before=None, after=out, metadata=None, request=request, user=user)
        except Exception:
            pass
        return out

    def cancel_job(self, job_id: int, user: Any, request: Any) -> Dict[str, Any]:
        j = self.repo.get_by_id(job_id)
        if not j:
            raise ValueError("Job not found")
        if j.status in ("pending", "running"):
            before_status = j.status
            j.status = "canceled"
            j.finished_at = now_iso()
            self.repo.update(j)
            try:
                log_event(self.session, action="job.cancel", entity_type="job", entity_id=j.id, entity_name=str(j.id), before={"status": before_status}, after={"status": j.status}, metadata={"status_from": before_status, "status_to": j.status}, request=request, user=user)
            except Exception:
                pass
        return self.job_to_out(j)

    def _update_queue_items_for_job(self, job: Job, final_status: str):
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
                qi = self.session.exec(select(QueueItem).where(QueueItem.id == qid)).first()
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
            self.session.add(qi)

    def job_to_out(self, j: Job) -> dict:
        def parse_json(s: Optional[str]):
            if not s:
                return None
            try:
                return json.loads(s)
            except Exception:
                return None
        process_out = None
        robot_out = None
        if j.process_id:
            p = self.session.exec(select(Process).where(Process.id == j.process_id)).first()
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
            r = self.session.exec(select(Robot).where(Robot.id == j.robot_id)).first()
            if r:
                machine_name = None
                if r.machine_id:
                    m = self.session.exec(select(Machine).where(Machine.id == r.machine_id)).first()
                    machine_name = m.name if m else None
                robot_out = {
                    "id": r.id,
                    "name": r.name,
                    "status": r.status,
                    "machine_name": machine_name,
                    "machine_info": r.machine_info,
                    "last_heartbeat": r.last_heartbeat,
                    "current_job_id": r.current_job_id,
                    "created_at": r.created_at,
                    "updated_at": r.updated_at,
                }
        # Use stored machine_name from job, fallback to robot's machine if not set (backward compatibility)
        machine_name = getattr(j, "machine_name", None)
        if not machine_name and robot_out and robot_out.get("machine_name"):
            machine_name = robot_out.get("machine_name")
        
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
            "hostname": machine_name,  # Display as hostname (stored as machine_name in DB)
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

