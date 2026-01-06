from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import select
from backend.db import get_session
from backend.auth import get_current_user
from backend.permissions import require_permission
from backend.services.robot_service import RobotService

router = APIRouter(prefix="/robots", tags=["robots"])


def _get_robot_internal_id(session, external_id: str) -> int:
    """Resolve robot by external_id (public GUID). Numeric IDs are rejected for management routes."""
    try:
        int(external_id)
        raise HTTPException(status_code=400, detail="Robot identifiers must be external_id (GUID)")
    except ValueError:
        pass
    from backend.models import Robot  # local import to avoid circulars
    obj = session.exec(select(Robot).where(Robot.external_id == external_id)).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Robot not found")
    return obj.id

@router.get("/", dependencies=[Depends(get_current_user), Depends(require_permission("robots", "view"))])
def list_robots(search: Optional[str] = None, status: Optional[str] = None, session=Depends(get_session)):
    service = RobotService(session)
    return service.list_robots(search, status)


@router.get("/{robot_external_id}", dependencies=[Depends(get_current_user), Depends(require_permission("robots", "view"))])
def get_robot(robot_external_id: str, session=Depends(get_session)):
    service = RobotService(session)
    internal_id = _get_robot_internal_id(session, robot_external_id)
    robot = service.get_robot(internal_id)
    if not robot:
        raise HTTPException(status_code=404, detail="Robot not found")
    return robot

@router.post("/", status_code=201, dependencies=[Depends(get_current_user), Depends(require_permission("robots", "create"))])
def create_robot(payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    service = RobotService(session)
    try:
        return service.create_robot(payload, user, request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/{robot_external_id}", dependencies=[Depends(get_current_user), Depends(require_permission("robots", "edit"))])
def update_robot(robot_external_id: str, payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    service = RobotService(session)
    internal_id = _get_robot_internal_id(session, robot_external_id)
    try:
        return service.update_robot(internal_id, payload, user, request)
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{robot_external_id}", status_code=204, dependencies=[Depends(get_current_user), Depends(require_permission("robots", "delete"))])
def delete_robot(robot_external_id: str, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    service = RobotService(session)
    internal_id = _get_robot_internal_id(session, robot_external_id)
    try:
        service.delete_robot(internal_id, user, request)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return None

@router.post("/{robot_id}/heartbeat", dependencies=[Depends(get_current_user), Depends(require_permission("robots", "edit"))])
def robot_heartbeat(robot_id: int, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    service = RobotService(session)
    try:
        return service.robot_heartbeat(robot_id, user, request)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
