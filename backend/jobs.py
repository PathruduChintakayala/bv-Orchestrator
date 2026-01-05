from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from backend.db import get_session
from backend.auth import get_current_user
from backend.permissions import require_permission
from backend.services.job_service import JobService

router = APIRouter(prefix="/jobs", tags=["jobs"])

@router.get("/", dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "view"))])
def list_jobs(status: Optional[str] = None, process_id: Optional[int] = None, robot_id: Optional[int] = None, session=Depends(get_session)):
    service = JobService(session)
    return service.list_jobs(status, process_id, robot_id)

@router.get("/{job_id}", dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "view"))])
def get_job(job_id: int, session=Depends(get_session)):
    service = JobService(session)
    job = service.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@router.post("/", status_code=201, dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "create"))])
def create_job(payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    service = JobService(session)
    try:
        return service.create_job(payload, user, request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/{job_id}", dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "edit"))])
def update_job(job_id: int, payload: dict, request: Request, background_tasks: BackgroundTasks, session=Depends(get_session), user=Depends(get_current_user)):
    service = JobService(session)
    try:
        return service.update_job(job_id, payload, user, request, background_tasks)
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{job_id}/cancel", dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "edit"))])
def cancel_job(job_id: int, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    service = JobService(session)
    try:
        return service.cancel_job(job_id, user, request)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
