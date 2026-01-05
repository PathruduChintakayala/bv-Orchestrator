import asyncio
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from sqlmodel import Session
from backend.db import get_session, engine
from backend.models import Robot
from backend.robot_dependencies import get_current_robot
from backend.services.runner_service import RunnerService

router = APIRouter(prefix="/runner", tags=["runner"])
log = logging.getLogger("runner")

@router.post("/connect-machine")
def connect_machine(payload: dict, request: Request, session: Session = Depends(get_session)):
    service = RunnerService(session)
    try:
        return service.connect_machine(payload, request)
    except ValueError as e:
        if "Invalid machine_key" in str(e):
            raise HTTPException(status_code=401, detail=str(e))
        if "does not match" in str(e) or "not in runner mode" in str(e):
            raise HTTPException(status_code=403, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/assigned-robots")
def assigned_robots(machine_key: str, machine_signature: str, session: Session = Depends(get_session)):
    service = RunnerService(session)
    try:
        return service.get_assigned_robots(machine_key, machine_signature)
    except ValueError as e:
        if "Invalid machine_key" in str(e):
            raise HTTPException(status_code=401, detail=str(e))
        if "mismatch" in str(e):
            raise HTTPException(status_code=403, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/heartbeat")
def runner_heartbeat(payload: dict, request: Request, session: Session = Depends(get_session), current_robot: Robot = Depends(get_current_robot)):
    rid = payload.get("robot_id")
    if rid is not None and int(rid) != int(current_robot.id):
        raise HTTPException(status_code=400, detail="robot_id does not match token")
    
    service = RunnerService(session)
    try:
        return service.heartbeat(current_robot, payload, request)
    except ValueError as e:
        if "mismatch" in str(e):
            raise HTTPException(status_code=403, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/next-job")
def next_job(payload: dict, request: Request, session: Session = Depends(get_session), current_robot: Robot = Depends(get_current_robot)):
    rid = payload.get("robot_id")
    if rid is not None and int(rid) != int(current_robot.id):
        raise HTTPException(status_code=400, detail="robot_id does not match token")
    
    service = RunnerService(session)
    try:
        return service.get_next_job(current_robot, payload, request)
    except ValueError as e:
        if "mismatch" in str(e):
            raise HTTPException(status_code=403, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/jobs/{job_id}/update")
def update_job_status(job_id: int, payload: dict, request: Request, background_tasks: BackgroundTasks, session: Session = Depends(get_session), current_robot: Robot = Depends(get_current_robot)):
    service = RunnerService(session)
    try:
        return service.update_job_status(current_robot, job_id, payload, request, background_tasks)
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        if "not assigned" in str(e).lower():
            raise HTTPException(status_code=403, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/register-robot")
def register_robot():
    raise HTTPException(status_code=410, detail="Robot auto-registration is disabled; use connect-machine and assigned-robots")

class RobotHeartbeatMonitor:
    def __init__(self, db_engine):
        self.engine = db_engine
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
                with Session(self.engine) as session:
                    service = RunnerService(session)
                    service.tick()
            except Exception as exc:
                log.exception("Heartbeat monitor tick failed: %s", exc)
            await asyncio.sleep(10)

heartbeat_monitor = RobotHeartbeatMonitor(engine)
