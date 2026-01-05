import logging
from datetime import datetime
from typing import List, Optional, Any
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status, Header
from fastapi.responses import JSONResponse
from sqlmodel import Session, select

from backend.auth import get_current_user
from backend.db import get_session
from backend.models import Job, JobExecutionLog, Robot, Machine, Asset, Process
from backend.timezone_utils import get_display_timezone, to_display_iso
from backend.permissions import require_permission, has_permission
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


def get_runtime_auth(
    request: Request,
    session: Session = Depends(get_session),
    x_robot_token: Optional[str] = Header(None, alias="X-Robot-Token")
) -> Any:
    """Check for either a valid user session or a robot token."""
    # 1. Try Robot Token
    if x_robot_token:
        robot = session.exec(select(Robot).where(Robot.api_token == x_robot_token)).first()
        if robot:
            return robot

    # 2. Try User Token (Standard Auth)
    auth_header = request.headers.get("Authorization")
    if auth_header:
        try:
            from backend.auth import SECRET_KEY, ALGORITHM
            from jose import jwt
            from backend.models import User
            
            if not auth_header.startswith("Bearer "):
                raise HTTPException(status_code=401, detail="Authorization header must start with 'Bearer '")
            
            token = auth_header.split(" ", 1)[1].strip()
            if not token:
                raise HTTPException(status_code=401, detail="Token is missing")
            
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            username = payload.get("sub")
            if not username:
                raise HTTPException(status_code=401, detail="Token missing 'sub' claim")
            
            user = session.exec(select(User).where(User.username == username)).first()
            if not user:
                raise HTTPException(status_code=401, detail=f"User '{username}' not found")
            
            # For logging, users need jobs:view permission
            if has_permission(session, user, "jobs", "view"):
                return user
            raise HTTPException(status_code=403, detail="Insufficient permissions: 'jobs:view' required")
        except HTTPException:
            raise
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token has expired")
        except jwt.JWTError as e:
            raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
        except Exception as e:
            import logging
            logging.error(f"Error in get_runtime_auth for job_execution_logs: {type(e).__name__}: {str(e)}")
            raise HTTPException(status_code=401, detail=f"Authentication failed: {str(e)}")

    raise HTTPException(status_code=401, detail="Valid user or robot token required")


@router.post("/{execution_id}/logs", status_code=status.HTTP_202_ACCEPTED)
def add_job_execution_log(
    execution_id: str,
    payload: dict,
    request: Request,
    session: Session = Depends(get_session),
    auth=Depends(get_runtime_auth),
):
    job = _get_job_or_404(session, execution_id)
    
    # Validate job access based on auth type
    if isinstance(auth, Robot):
        # For robots: job must be assigned to this robot (or unassigned)
        if job.robot_id is not None and int(job.robot_id) != int(auth.id):
            raise HTTPException(status_code=403, detail="Job not assigned to this robot")
        current_robot = auth
    else:
        # For users: job must exist and user must have permission (already checked in get_runtime_auth)
        current_robot = None

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
    
    if current_robot:
        # Robot authentication: resolve machine and identity from robot
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
    else:
        # User authentication: use user's username as host_identity
        if hasattr(auth, "username"):
            host_identity = auth.username
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

    tz = get_display_timezone(session)

    return [
        {
            "timestamp": to_display_iso(row.timestamp, tz),
            "level": row.level,
            "message": row.message,
            "processId": row.process_id,
            "processName": row.process_name,
            "machineId": row.machine_id,
            "machineName": row.machine_name,
            "hostName": row.host_name,
            "hostIdentity": row.host_identity,
        }
        for row in rows
    ]
