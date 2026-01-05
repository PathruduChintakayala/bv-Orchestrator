from datetime import datetime, date, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlmodel import select

from backend.db import get_session
from backend.auth import get_current_user
from backend.models import Robot, Process, Job, Asset, Queue, Trigger, Machine, User
from backend.timezone_utils import get_display_timezone, to_display_iso

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

@router.get("/overview")
def get_overview(session=Depends(get_session), user=Depends(get_current_user)):
    try:
        display_tz = get_display_timezone(session)
        robots = session.exec(select(Robot)).all()
        machines = session.exec(select(Machine)).all()
        processes = session.exec(select(Process)).all()
        jobs = session.exec(select(Job)).all()
        assets = session.exec(select(Asset)).all()
        queues = session.exec(select(Queue)).all()
        triggers = session.exec(select(Trigger)).all()
        accounts = session.exec(select(User)).all()

        now_utc = datetime.utcnow().replace(tzinfo=timezone.utc)
        window_start = now_utc - timedelta(hours=24)

        def _to_utc_dt(val):
            if not val:
                return None
            try:
                dt = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.astimezone(timezone.utc)
            except Exception:
                return None

        job_history = {"total": 0, "success": 0, "failed": 0, "stopped": 0}

        success_statuses = {"completed", "success"}
        failed_statuses = {"failed", "error"}
        stopped_statuses = {"canceled", "cancelled", "stopped"}

        today_str = date.today().isoformat()
        jobs_today = [j for j in jobs if (j.created_at or "").startswith(today_str)]
        jobs_today_success = sum(1 for j in jobs_today if j.status == "completed")
        jobs_today_failed = sum(1 for j in jobs_today if j.status == "failed")
        running_jobs = [j for j in jobs if j.status == "running"]

        for j in jobs:
            end_dt = _to_utc_dt(getattr(j, "finished_at", None) or getattr(j, "started_at", None) or getattr(j, "created_at", None))
            if not end_dt or end_dt < window_start:
                continue
            job_history["total"] += 1
            status = (j.status or "").lower()
            if status in success_statuses:
                job_history["success"] += 1
            elif status in failed_statuses:
                job_history["failed"] += 1
            elif status in stopped_statuses:
                job_history["stopped"] += 1

        online_count = sum(1 for r in robots if (r.status or "").lower() in ("online", "connected"))
        offline_count = sum(1 for r in robots if (r.status or "").lower() in ("offline", "disconnected"))

        summary = {
            "total_robots": len(robots),
            "online_robots": online_count,
            "offline_robots": offline_count,
            "jobs_today_total": len(jobs_today),
            "jobs_today_success": jobs_today_success,
            "jobs_today_failed": jobs_today_failed,
            "running_jobs": len(running_jobs),
            "total_processes": len(processes),
            "active_processes": sum(1 for p in processes if p.is_active),
            "total_assets": len(assets),
            "total_queues": len(queues),
            "total_triggers": len(triggers),
            "total_accounts": len(accounts),
            "total_machines": len(machines),
        }

        job_status_counts = {
            "running": 0,
            "pending": 0,
            "stopping": 0,
            "terminating": 0,
            "suspended": 0,
            "resumed": 0,
        }
        for j in jobs:
            s = (j.status or "").lower()
            if s in job_status_counts:
                job_status_counts[s] += 1

        # robots with current job + process name
        recent_jobs_sorted = sorted(jobs, key=lambda j: (j.created_at or ""), reverse=True)[:10]

        def find_process_name(pid: Optional[int]) -> Optional[str]:
            if pid is None:
                return None
            p = session.exec(select(Process).where(Process.id == pid)).first()
            return p.name if p else None

        def find_robot_name(rid: Optional[int]) -> Optional[str]:
            if rid is None:
                return None
            r = session.exec(select(Robot).where(Robot.id == rid)).first()
            return r.name if r else None

        robots_out = []
        for r in robots:
            current_process_name = None
            if r.current_job_id:
                job = session.exec(select(Job).where(Job.id == r.current_job_id)).first()
                if job:
                    current_process_name = find_process_name(job.process_id)
            robots_out.append({
                "id": r.id,
                "name": r.name,
                "status": r.status,
                "last_heartbeat": to_display_iso(r.last_heartbeat, display_tz),
                "current_job_id": r.current_job_id,
                "current_process_name": current_process_name,
            })

        def compute_duration_seconds(j: Job) -> Optional[int]:
            if not j.started_at or not j.finished_at:
                return None
            try:
                start = datetime.fromisoformat(j.started_at)
                end = datetime.fromisoformat(j.finished_at)
                return int((end - start).total_seconds())
            except Exception:
                return None

        recent_jobs_out = []
        for j in recent_jobs_sorted:
            recent_jobs_out.append({
                "id": j.id,
                "process_name": find_process_name(j.process_id),
                "robot_name": find_robot_name(j.robot_id),
                "status": j.status,
                "created_at": to_display_iso(j.created_at, display_tz),
                "started_at": to_display_iso(j.started_at, display_tz),
                "finished_at": to_display_iso(j.finished_at, display_tz),
                "duration_seconds": compute_duration_seconds(j),
            })

        return {
            "summary": summary,
            "robots": robots_out,
            "recent_jobs": recent_jobs_out,
            "job_history_24h": job_history,
            "job_status_counts": job_status_counts,
        }
    except Exception as e:
        # Surface error to help diagnose during development
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"dashboard_error: {e}")
