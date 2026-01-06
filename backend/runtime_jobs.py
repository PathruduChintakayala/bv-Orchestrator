from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.db import get_session
from backend.models import Job, Robot
from backend.job_execution_logs import get_runtime_auth

router = APIRouter(prefix="/runtime/jobs", tags=["runtime-jobs"])


class StopRequestedResponse(BaseModel):
    stop_requested: bool

    class Config:
        extra = "forbid"  # Ensure the response stays minimal and stable


def _is_stop_requested(job: Job) -> bool:
    """Derive stop signal from job control_signal or an explicit stop flag if present.

    STOP is represented as control_signal == "STOP" (preferred) or a future
    stop_requested boolean if added later. This function is read-only to keep
    the endpoint side-effect free.
    """
    if getattr(job, "control_signal", None) == "STOP":
        return True
    # Fallback in case a stop_requested column exists in the future.
    if hasattr(job, "stop_requested") and bool(getattr(job, "stop_requested", False)):
        return True
    return False


@router.get("/{job_id}/stop-requested", response_model=StopRequestedResponse, response_model_exclude_none=True)
def get_stop_requested(
    job_id: int,
    session: Session = Depends(get_session),
    auth=Depends(get_runtime_auth),
):
    job = session.exec(select(Job).where(Job.id == job_id)).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Runtime auth: only the robot assigned to this job (or unassigned) may query.
    if isinstance(auth, Robot):
        if job.robot_id is not None and int(job.robot_id) != int(auth.id):
            raise HTTPException(status_code=403, detail="Job not assigned to this robot")
    else:
        # get_runtime_auth already enforces users must have jobs:view; keep consistent.
        pass

    return StopRequestedResponse(stop_requested=_is_stop_requested(job))
