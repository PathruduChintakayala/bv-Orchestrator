import logging
from datetime import datetime
from typing import List, Optional
import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlmodel import Session, select

from backend.auth import get_current_user
from backend.db import get_session
from backend.models import Job, JobExecutionLog, Robot, Machine, Asset, Process
from backend.permissions import require_permission
from backend.robot_dependencies import get_current_robot

router = APIRouter(prefix="/job-executions", tags=["job-executions"])

LOG_LEVELS = {"TRACE", "INFO", "WARN", "ERROR"}
logger = logging.getLogger(__name__)


def _parse_iso_timestamp(raw: str) -> datetime:
    if not raw or not isinstance(raw, str):
        raise ValueError("timestamp missing")
    candidate = raw.strip()
    if not candidate:
        raise ValueError("timestamp missing")
    normalized = candidate.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except Exception as exc:  # noqa: BLE001
        raise ValueError("invalid timestamp") from exc


def _get_job_or_404(session: Session, execution_id: str) -> Job:
    job_id: Optional[int] = None
    try:
        job_id = int(execution_id)
    except Exception:
        job_id = None

    job = None
    if job_id is not None:
        job = session.exec(select(Job).where(Job.id == job_id)).first()
    if not job:
        job = session.exec(select(Job).where(Job.execution_id == str(execution_id))).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job execution not found")
    return job


@router.post("/{execution_id}/logs", status_code=status.HTTP_202_ACCEPTED)
def add_job_execution_log(
    execution_id: str,
    payload: dict,
    session: Session = Depends(get_session),
    current_robot: Robot = Depends(get_current_robot),
):
    job = _get_job_or_404(session, execution_id)
    if job.robot_id is not None and int(job.robot_id) != int(current_robot.id):
        raise HTTPException(status_code=403, detail="Job not assigned to this robot")

    try:
        ts = _parse_iso_timestamp(payload.get("timestamp"))
    except Exception:
        raise HTTPException(status_code=400, detail="timestamp must be ISO-8601 datetime")

    level_in = str(payload.get("level") or "").upper()
    if level_in not in LOG_LEVELS:
        raise HTTPException(status_code=400, detail="level must be one of TRACE, INFO, WARN, ERROR")

    message = payload.get("message")
    if not isinstance(message, str) or not message.strip():
        raise HTTPException(status_code=400, detail="message is required")

    # Resolve host_name and host_identity at log creation time
    host_name: Optional[str] = None
    host_identity: Optional[str] = None
    machine_id: Optional[int] = None
    machine_name: Optional[str] = None
    process_id: Optional[int] = None
    process_name: Optional[str] = None
    if current_robot.machine_id:
        machine = session.exec(select(Machine).where(Machine.id == current_robot.machine_id)).first()
        if machine:
            host_name = machine.name
            machine_id = machine.id
            machine_name = machine.name
    # Use username from robot table as host_identity (preferred)
    if current_robot.username:
        host_identity = current_robot.username
    # Fallback to credential_asset_id for backward compatibility
    elif current_robot.credential_asset_id:
        asset = session.exec(select(Asset).where(Asset.id == current_robot.credential_asset_id)).first()
        if asset and asset.type == "credential":
            try:
                cred_data = json.loads(asset.value or "{}")
                host_identity = cred_data.get("username")
            except Exception:
                pass  # Ignore parsing errors, leave as None
    if job.process_id:
        process = session.exec(select(Process).where(Process.id == job.process_id)).first()
        if process:
            process_id = process.id
            process_name = process.name

    entry = JobExecutionLog(
        job_execution_id=getattr(job, "execution_id", str(execution_id)),
        timestamp=ts,
        level=level_in,
        message=message.strip(),
        process_id=process_id,
        process_name=process_name,
        machine_id=machine_id,
        machine_name=machine_name,
        host_name=host_name,
        host_identity=host_identity,
    )
    try:
        session.add(entry)
        session.commit()
    except Exception:
        session.rollback()
        logger.exception(
            "Failed to persist job execution log",
            extra={"execution_id": execution_id, "level": level_in},
        )
        return JSONResponse(status_code=status.HTTP_202_ACCEPTED, content={"status": "accepted", "stored": False})

    return {"status": "accepted", "stored": True}


@router.get(
    "/{execution_id}/logs",
    dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "view"))],
)
def list_job_execution_logs(
    execution_id: str,
    level: Optional[List[str]] = Query(default=None),
    from_timestamp: Optional[str] = Query(default=None, alias="fromTimestamp"),
    to_timestamp: Optional[str] = Query(default=None, alias="toTimestamp"),
    limit: int = Query(default=200),
    order: str = Query(default="asc"),
    session: Session = Depends(get_session),
):
    job = _get_job_or_404(session, execution_id)

    levels_filter: Optional[List[str]] = None
    if level:
        levels_filter = []
        for lv in level:
            val = str(lv or "").upper()
            if val not in LOG_LEVELS:
                raise HTTPException(status_code=400, detail="level must be one of TRACE, INFO, WARN, ERROR")
            levels_filter.append(val)

    from_ts: Optional[datetime] = None
    to_ts: Optional[datetime] = None
    if from_timestamp:
        try:
            from_ts = _parse_iso_timestamp(from_timestamp)
        except Exception:
            raise HTTPException(status_code=400, detail="fromTimestamp must be ISO-8601 datetime")
    if to_timestamp:
        try:
            to_ts = _parse_iso_timestamp(to_timestamp)
        except Exception:
            raise HTTPException(status_code=400, detail="toTimestamp must be ISO-8601 datetime")

    safe_limit = max(1, min(int(limit) if isinstance(limit, int) else 200, 1000))
    order_lower = (order or "asc").lower()
    if order_lower not in ("asc", "desc"):
        raise HTTPException(status_code=400, detail="order must be 'asc' or 'desc'")

    target_execution_id = getattr(job, "execution_id", str(execution_id))

    stmt = select(JobExecutionLog).where(JobExecutionLog.job_execution_id == target_execution_id)
    if levels_filter:
        stmt = stmt.where(JobExecutionLog.level.in_(levels_filter))
    if from_ts:
        stmt = stmt.where(JobExecutionLog.timestamp >= from_ts)
    if to_ts:
        stmt = stmt.where(JobExecutionLog.timestamp <= to_ts)

    if order_lower == "asc":
        stmt = stmt.order_by(JobExecutionLog.timestamp)
    else:
        stmt = stmt.order_by(JobExecutionLog.timestamp.desc())

    stmt = stmt.limit(safe_limit)
    rows = session.exec(stmt).all()

    return [
        {
            "timestamp": row.timestamp.isoformat(),
            "level": row.level,
            "message": row.message,
            "process_id": row.process_id,
            "process_name": row.process_name,
            "machine_id": row.machine_id,
            "machine_name": row.machine_name,
            "host_name": row.host_name,
            "host_identity": row.host_identity,
        }
        for row in rows
    ]
