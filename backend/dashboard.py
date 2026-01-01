from datetime import datetime, date
from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlmodel import select

from backend.db import get_session
from backend.auth import get_current_user
from backend.models import Robot, Process, Job

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

@router.get("/overview")
def get_overview(session=Depends(get_session), user=Depends(get_current_user)):
    try:
        robots = session.exec(select(Robot)).all()
        processes = session.exec(select(Process)).all()
        jobs = session.exec(select(Job)).all()

        today_str = date.today().isoformat()
        jobs_today = [j for j in jobs if (j.created_at or "").startswith(today_str)]
        jobs_today_success = sum(1 for j in jobs_today if j.status == "completed")
        jobs_today_failed = sum(1 for j in jobs_today if j.status == "failed")
        running_jobs = [j for j in jobs if j.status == "running"]

        summary = {
            "total_robots": len(robots),
            "online_robots": sum(1 for r in robots if r.status == "online"),
            "offline_robots": sum(1 for r in robots if r.status == "offline"),
            "jobs_today_total": len(jobs_today),
            "jobs_today_success": jobs_today_success,
            "jobs_today_failed": jobs_today_failed,
            "running_jobs": len(running_jobs),
            "total_processes": len(processes),
            "active_processes": sum(1 for p in processes if p.is_active),
        }

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
                "last_heartbeat": r.last_heartbeat,
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
                "created_at": j.created_at,
                "started_at": j.started_at,
                "finished_at": j.finished_at,
                "duration_seconds": compute_duration_seconds(j),
            })

        return {
            "summary": summary,
            "robots": robots_out,
            "recent_jobs": recent_jobs_out,
        }
    except Exception as e:
        # Surface error to help diagnose during development
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"dashboard_error: {e}")
