import secrets
import logging
from typing import Optional, List, Dict, Any
from sqlmodel import Session, select
from backend.models import Robot, Machine
from backend.repositories.robot_repository import RobotRepository
from backend.repositories.machine_repository import MachineRepository
from backend.audit_utils import log_event
from datetime import datetime

log = logging.getLogger("robots")

def now_iso():
    return datetime.now().isoformat(timespec='seconds')

class RobotService:
    def __init__(self, session: Session):
        self.session = session
        self.repo = RobotRepository(session)
        self.machine_repo = MachineRepository(session)

    def list_robots(self, search: Optional[str] = None, status: Optional[str] = None) -> List[Dict[str, Any]]:
        robots = self.repo.get_all()
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
        return [self.to_out(r) for r in robots]

    def get_robot(self, robot_id: int) -> Optional[Dict[str, Any]]:
        r = self.repo.get_by_id(robot_id)
        if not r:
            return None
        return self.to_out(r)

    def create_robot(self, payload: Dict[str, Any], user: Any, request: Any) -> Dict[str, Any]:
        name = (payload.get("name") or "").strip()
        if not name:
            raise ValueError("Name is required")
        if self.session.exec(select(Robot).where(Robot.name == name)).first():
            raise ValueError("A robot with this name already exists")

        machine_id = payload.get("machine_id")
        if machine_id is not None:
            m = self.machine_repo.get_by_id(int(machine_id))
            if not m:
                raise ValueError("Selected machine does not exist")
            if m.mode != "runner":
                raise ValueError("Selected machine is not in runner mode")

        username = None
        password_hash = None
        password_input = None
        cred = payload.get("credential")
        if isinstance(cred, dict):
            username_input = (cred.get("username") or "").strip()
            password_input = (cred.get("password") or "").strip()
            if not username_input or not password_input:
                raise ValueError("credential.username and credential.password are required")
            if machine_id is None:
                raise ValueError("A machine is required when supplying credentials")
            
            from backend.auth import get_password_hash as hash_secret
            username = username_input
            password_hash = hash_secret(password_input)

        r = Robot(
            name=name,
            status="disconnected",
            machine_id=int(machine_id) if machine_id is not None else None,
            machine_info=payload.get("machine_info") or None,
            username=username,
            password_hash=password_hash,
            api_token=secrets.token_hex(16),
            last_heartbeat=None,
            created_at=now_iso(),
            updated_at=now_iso(),
        )
        self.repo.create(r)
        
        if password_input:
            from backend.services.runner_service import RunnerService
            RunnerService(self.session).store_robot_password(r.id, password_input)
        
        out = self.to_out(r)
        try:
            log_event(self.session, action="robot.create", entity_type="robot", entity_id=r.id, entity_name=r.name, before=None, after=out, metadata=None, request=request, user=user)
        except Exception:
            pass
        return out

    def update_robot(self, robot_id: int, payload: Dict[str, Any], user: Any, request: Any) -> Dict[str, Any]:
        r = self.repo.get_by_id(robot_id)
        if not r:
            raise ValueError("Robot not found")
        before_out = self.to_out(r)
        
        if "name" in payload:
            new_name = (payload.get("name") or "").strip()
            if not new_name:
                raise ValueError("Name cannot be empty")
            if new_name != r.name:
                existing = self.session.exec(select(Robot).where(Robot.name == new_name)).first()
                if existing and existing.id != r.id:
                    raise ValueError("A robot with this name already exists")
                r.name = new_name
        
        if "status" in payload:
            raise ValueError("Robot status is managed by runner heartbeat")
        if "machine_info" in payload:
            r.machine_info = payload.get("machine_info") or None
        if "machine_id" in payload:
            mid = payload.get("machine_id")
            if mid is None or mid == "":
                r.machine_id = None
            else:
                m = self.machine_repo.get_by_id(int(mid))
                if not m:
                    raise ValueError("Selected machine does not exist")
                if m.mode != "runner":
                    raise ValueError("Selected machine is not in runner mode")
                r.machine_id = int(mid)
        
        password_input = None
        if "credential" in payload:
            cred = payload.get("credential")
            from backend.services.runner_service import RunnerService
            runner_service = RunnerService(self.session)
            if cred is None:
                r.username = None
                r.password_hash = None
                runner_service.clear_robot_password(r.id)
            elif isinstance(cred, dict):
                username_input = (cred.get("username") or "").strip()
                password_input = (cred.get("password") or "").strip()
                if not username_input or not password_input:
                    raise ValueError("credential.username and credential.password are required")
                
                if not r.machine_id:
                    raise ValueError("Robot must be assigned to a machine to update credentials")
                
                from backend.auth import get_password_hash as hash_secret
                r.username = username_input
                r.password_hash = hash_secret(password_input)
        
        r.updated_at = now_iso()
        self.repo.update(r)
        
        if password_input:
            from backend.services.runner_service import RunnerService
            RunnerService(self.session).store_robot_password(r.id, password_input)
        
        after_out = self.to_out(r)
        try:
            action = "robot.status_change" if before_out.get("status") != after_out.get("status") else "robot.update"
            log_event(self.session, action=action, entity_type="robot", entity_id=r.id, entity_name=r.name, before=before_out, after=after_out, metadata=None, request=request, user=user)
        except Exception:
            pass
        return after_out

    def delete_robot(self, robot_id: int, user: Any, request: Any) -> None:
        r = self.repo.get_by_id(robot_id)
        if not r:
            raise ValueError("Robot not found")
        before_out = self.to_out(r)
        self.repo.delete(r)
        try:
            log_event(self.session, action="robot.delete", entity_type="robot", entity_id=robot_id, entity_name=before_out.get("name"), before=before_out, after=None, metadata=None, request=request, user=user)
        except Exception:
            pass

    def robot_heartbeat(self, robot_id: int, user: Any, request: Any) -> Dict[str, Any]:
        r = self.repo.get_by_id(robot_id)
        if not r:
            raise ValueError("Robot not found")
        r.last_heartbeat = now_iso()
        r.status = "connected"
        r.updated_at = now_iso()
        self.repo.update(r)
        try:
            log_event(self.session, action="robot.status_change", entity_type="robot", entity_id=r.id, entity_name=r.name, before=None, after={"status": r.status, "last_heartbeat": r.last_heartbeat}, metadata=None, request=request, user=user)
        except Exception:
            pass
        return {"status": "ok"}

    def to_out(self, r: Robot) -> dict:
        machine_name = None
        if r.machine_id:
            m = self.machine_repo.get_by_id(r.machine_id)
            machine_name = m.name if m else None
        return {
            "id": r.id,
            "name": r.name,
            "status": r.status,
            "machine_id": r.machine_id,
            "machine_name": machine_name,
            "machine_info": r.machine_info,
            "credential_asset_id": r.credential_asset_id,
            "username": r.username,
            "last_heartbeat": r.last_heartbeat,
            "current_job_id": r.current_job_id,
            "created_at": r.created_at,
            "updated_at": r.updated_at,
        }

