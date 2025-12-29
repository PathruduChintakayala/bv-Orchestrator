import math
from datetime import datetime
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlmodel import Session, select

from .auth import get_current_user
from .db import get_session
from .models import JobExecutionLog, Job, Process, Robot, Machine
from .permissions import require_permission

router = APIRouter(prefix="/logs", tags=["logs"])


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid datetime format; use ISO-8601")


def _build_filters(
    session: Session,
    from_ts: Optional[str],
    to_ts: Optional[str],
    level: Optional[str],
    process_id: Optional[int],
    machine_id: Optional[int],
    host_identity: Optional[str],
    search: Optional[str],
):
    stmt = select(JobExecutionLog, Job, Process, Robot, Machine)
    stmt = stmt.join(Job, Job.execution_id == JobExecutionLog.job_execution_id, isouter=True)
    stmt = stmt.join(Process, Process.id == Job.process_id, isouter=True)
    stmt = stmt.join(Robot, Robot.id == Job.robot_id, isouter=True)
    stmt = stmt.join(Machine, Machine.id == Robot.machine_id, isouter=True)

    if level and level.upper() != "ALL":
        stmt = stmt.where(JobExecutionLog.level == level.upper())
    if from_ts:
        stmt = stmt.where(JobExecutionLog.timestamp >= _parse_dt(from_ts))
    if to_ts:
        stmt = stmt.where(JobExecutionLog.timestamp <= _parse_dt(to_ts))
    if process_id:
        stmt = stmt.where(Job.process_id == process_id)
    if machine_id:
        stmt = stmt.where(Machine.id == machine_id)
    if host_identity:
        stmt = stmt.where((Machine.machine_info == host_identity) | (Robot.machine_info == host_identity))
    if search:
        like = f"%{search}%"
        stmt = stmt.where(JobExecutionLog.message.ilike(like))
    return stmt


def _paginate(stmt, limit: int, offset: int, order: str):
    safe_limit = max(1, min(limit, 1000))
    safe_offset = max(0, offset)
    if order.lower() == "asc":
        stmt = stmt.order_by(JobExecutionLog.timestamp.asc())
    else:
        stmt = stmt.order_by(JobExecutionLog.timestamp.desc())
    stmt = stmt.limit(safe_limit).offset(safe_offset)
    return stmt, safe_limit, safe_offset


def _count(session: Session, base_stmt) -> int:
    count_stmt = select(func.count()).select_from(base_stmt.subquery())
    return session.exec(count_stmt).one()


@router.get("/", dependencies=[Depends(get_current_user), Depends(require_permission("jobs", "view"))])
def list_logs(
    from_ts: Optional[str] = Query(default=None, alias="from"),
    to_ts: Optional[str] = Query(default=None, alias="to"),
    level: Optional[str] = Query(default=None),
    process_id: Optional[int] = Query(default=None),
    machine_id: Optional[int] = Query(default=None),
    host_identity: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    limit: int = Query(default=100),
    offset: int = Query(default=0),
    order: str = Query(default="desc"),
    session: Session = Depends(get_session),
):
    order_safe = order.lower() if isinstance(order, str) else "desc"
    if order_safe not in ("asc", "desc"):
        raise HTTPException(status_code=400, detail="order must be asc or desc")

    base_stmt = _build_filters(session, from_ts, to_ts, level, process_id, machine_id, host_identity, search)
    total = _count(session, base_stmt)
    stmt, safe_limit, safe_offset = _paginate(base_stmt, limit, offset, order_safe)
    rows = session.exec(stmt).all()

    items = []
    for log_row, job, proc, robot, machine in rows:
        host_identity_val = None
        if machine and getattr(machine, "machine_info", None):
            host_identity_val = machine.machine_info
        elif robot and getattr(robot, "machine_info", None):
            host_identity_val = robot.machine_info
        items.append(
            {
                "timestamp": log_row.timestamp.isoformat(),
                "level": log_row.level,
                "message": log_row.message,
                "processId": getattr(proc, "id", None),
                "processName": getattr(proc, "name", None),
                "machineId": getattr(machine, "id", None),
                "machineName": getattr(machine, "name", None),
                "hostIdentity": host_identity_val,
            }
        )

    return {
        "items": items,
        "total": total,
        "limit": safe_limit,
        "offset": safe_offset,
        "order": order_safe,
    }
