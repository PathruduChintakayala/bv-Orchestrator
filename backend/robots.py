from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from backend.db import get_session
from backend.auth import get_current_user
from backend.permissions import require_permission
from backend.services.robot_service import RobotService

router = APIRouter(prefix="/robots", tags=["robots"])

@router.get("/", dependencies=[Depends(get_current_user), Depends(require_permission("robots", "view"))])
def list_robots(search: Optional[str] = None, status: Optional[str] = None, session=Depends(get_session)):
    service = RobotService(session)
    return service.list_robots(search, status)

@router.get("/{robot_id}", dependencies=[Depends(get_current_user), Depends(require_permission("robots", "view"))])
def get_robot(robot_id: int, session=Depends(get_session)):
    service = RobotService(session)
    robot = service.get_robot(robot_id)
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

@router.put("/{robot_id}", dependencies=[Depends(get_current_user), Depends(require_permission("robots", "edit"))])
def update_robot(robot_id: int, payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    service = RobotService(session)
    try:
        return service.update_robot(robot_id, payload, user, request)
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{robot_id}", status_code=204, dependencies=[Depends(get_current_user), Depends(require_permission("robots", "delete"))])
def delete_robot(robot_id: int, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    service = RobotService(session)
    try:
        service.delete_robot(robot_id, user, request)
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
