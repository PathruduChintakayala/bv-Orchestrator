import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, Optional

from sqlalchemy import delete, func
from sqlmodel import Session, select

from backend.db import engine
from backend.models import QueueItem, JobExecutionLog, AuditEvent
from backend.redis_client import redis_client
from backend.audit_utils import log_event
from backend.settings import get_retention_settings, MAX_RETENTION_DAYS

log = logging.getLogger("retention.cleanup")

TERMINAL_QUEUE_STATUSES = {"DONE", "FAILED", "ABANDONED", "DELETED"}


def _coerce_db_now(raw: Optional[object]) -> datetime:
    """Convert DB NOW() output into a timezone-aware UTC datetime where possible."""
    try:
        candidate = raw[0] if isinstance(raw, (list, tuple)) else raw
        if isinstance(candidate, datetime):
            return candidate
        if isinstance(candidate, str):
            normalized = candidate.replace("Z", "+00:00")
            try:
                return datetime.fromisoformat(normalized)
            except Exception:
                pass
    except Exception:
        pass
    return datetime.utcnow()


class RetentionCleanupService:
    def __init__(self, db_engine, interval_hours: int = 24, lock_ttl_seconds: int = 900, batch_size: int = 500):
        self.engine = db_engine
        self.interval_seconds = max(interval_hours * 3600, 60)
        self._task: Optional[asyncio.Task] = None
        self._stopped = False
        self.lock_key = "retention-cleanup"
        self.lock_ttl_seconds = lock_ttl_seconds
        self.batch_size = batch_size

    def start(self):
        if self._task and not self._task.done():
            return
        self._stopped = False
        self._task = asyncio.create_task(self._run(), name="retention-cleanup")

    async def stop(self):
        self._stopped = True
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=10)
            except Exception:
                pass

    async def _run(self):
        while not self._stopped:
            if redis_client._client.set(self.lock_key, "1", nx=True, ex=self.lock_ttl_seconds):
                try:
                    await self._tick()
                except Exception:
                    log.exception("Retention cleanup tick failed")
            await asyncio.sleep(self.interval_seconds)

    async def _tick(self):
        with Session(self.engine) as session:
            settings = get_retention_settings(session)
            if not settings.get("retention_enabled", True):
                log.info("Retention cleanup skipped (disabled)")
                return

            db_now_raw = session.exec(select(func.now())).one_or_none()
            db_now = _coerce_db_now(db_now_raw)

            summary = {
                "queue_items_deleted": self._cleanup_queue_items(session, settings, db_now),
                "job_logs_deleted": self._cleanup_job_logs(session, settings, db_now),
                "audit_logs_deleted": self._cleanup_audit_logs(session, settings, db_now),
            }

            log.info("Retention cleanup complete: %s", summary)
            try:
                log_event(
                    session,
                    action="RETENTION_CLEANUP_RUN",
                    entity_type="retention",
                    entity_id=None,
                    entity_name="retention",
                    before=None,
                    after=None,
                    metadata=summary,
                    request=None,
                    user=None,
                    actor_username="system",
                    system=True,
                )
            except Exception:
                # Never block cleanup on audit logging
                pass

    def _cleanup_queue_items(self, session: Session, settings: Dict[str, object], db_now: datetime) -> int:
        days = int(settings.get("queue_items_retention_days", MAX_RETENTION_DAYS))
        cutoff = db_now - timedelta(days=min(days, MAX_RETENTION_DAYS))
        cutoff_iso = cutoff.isoformat()
        total_deleted = 0
        while True:
            ids = session.exec(
                select(QueueItem.id)
                .where(QueueItem.status.in_(TERMINAL_QUEUE_STATUSES))
                .where(QueueItem.completed_at.isnot(None))
                .where(QueueItem.completed_at < cutoff_iso)
                .limit(self.batch_size)
            ).all()
            if not ids:
                break
            session.exec(delete(QueueItem).where(QueueItem.id.in_(ids)))
            session.commit()
            total_deleted += len(ids)
        return total_deleted

    def _cleanup_job_logs(self, session: Session, settings: Dict[str, object], db_now: datetime) -> int:
        days = int(settings.get("job_logs_retention_days", MAX_RETENTION_DAYS))
        cutoff = db_now - timedelta(days=min(days, MAX_RETENTION_DAYS))
        total_deleted = 0
        while True:
            ids = session.exec(
                select(JobExecutionLog.id)
                .where(JobExecutionLog.timestamp < cutoff)
                .limit(self.batch_size)
            ).all()
            if not ids:
                break
            session.exec(delete(JobExecutionLog).where(JobExecutionLog.id.in_(ids)))
            session.commit()
            total_deleted += len(ids)
        return total_deleted

    def _cleanup_audit_logs(self, session: Session, settings: Dict[str, object], db_now: datetime) -> int:
        days = int(settings.get("audit_logs_retention_days", MAX_RETENTION_DAYS))
        cutoff = db_now - timedelta(days=min(days, MAX_RETENTION_DAYS))
        cutoff_iso = cutoff.isoformat()
        total_deleted = 0
        while True:
            ids = session.exec(
                select(AuditEvent.id)
                .where(AuditEvent.timestamp < cutoff_iso)
                .limit(self.batch_size)
            ).all()
            if not ids:
                break
            session.exec(delete(AuditEvent).where(AuditEvent.id.in_(ids)))
            session.commit()
            total_deleted += len(ids)
        return total_deleted


retention_worker = RetentionCleanupService(engine)
