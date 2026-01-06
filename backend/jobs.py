from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from sqlmodel import Session, select
from backend.db import get_session
from backend.auth import get_current_user
from backend.permissions import require_permission
from backend.services.job_service import JobService
from backend.models import Job

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _get_job_by_external_id(session: Session, external_id: str) -> Job:
    """Resolve job by external_id (public GUID). Numeric IDs are rejected for management routes."""
    try:
        int(external_id)
        raise HTTPException(status_code=400, detail="Job identifiers must be external_id (GUID)")
    except ValueError:
        pass
    job = session.exec(select(Job).where(Job.external_id == external_id)).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@router.get("/", dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "view"))])
def list_jobs(status: Optional[str] = None, process_id: Optional[int] = None, robot_id: Optional[int] = None, session=Depends(get_session)):
    service = JobService(session)
    return service.list_jobs(status, process_id, robot_id)

@router.get("/{job_external_id}", dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "view"))])
def get_job(job_external_id: str, session=Depends(get_session)):
    job_row = _get_job_by_external_id(session, job_external_id)
    service = JobService(session)
    return service.job_to_out(job_row)

@router.post("/", status_code=201, dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "create"))])
def create_job(payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    service = JobService(session)
    try:
        return service.create_job(payload, user, request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/{job_external_id}", dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "edit"))])
def update_job(job_external_id: str, payload: dict, request: Request, background_tasks: BackgroundTasks, session=Depends(get_session), user=Depends(get_current_user)):
    job_row = _get_job_by_external_id(session, job_external_id)
    service = JobService(session)
    try:
        return service.update_job(job_row.id, payload, user, request, background_tasks)
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{job_external_id}/cancel", dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "edit"))])
def cancel_job(job_external_id: str, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    job_row = _get_job_by_external_id(session, job_external_id)
    service = JobService(session)
    try:
        return service.cancel_job(job_row.id, user, request)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{job_external_id}/stop", dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "edit"))])
def stop_job(job_external_id: str, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    job_row = _get_job_by_external_id(session, job_external_id)
    service = JobService(session)
    try:
        return service.stop_job(job_row.id, user, request)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{job_external_id}/kill", dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "edit"))])
def kill_job(job_external_id: str, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    job_row = _get_job_by_external_id(session, job_external_id)
    service = JobService(session)
    try:
        return service.kill_job(job_row.id, user, request)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
