import asyncio
import logging
import json
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from typing import Optional, List

from croniter import croniter
from sqlmodel import Session, select

from backend.db import engine
from backend.models import Trigger, TriggerType, Process, Package, Job, JobExecutionLog, QueueItem

log = logging.getLogger("trigger.scheduler")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _next_fire(cron_expr: str, tz_name: Optional[str], base: datetime) -> datetime:
    zone = None
    if tz_name:
        try:
            zone = ZoneInfo(tz_name)
        except Exception:
            zone = None
    zone = zone or timezone.utc
    base_local = base.astimezone(zone)
    itr = croniter(cron_expr, base_local)
    nxt = itr.get_next(datetime)
    return nxt.astimezone(timezone.utc)


def _next_poll(base: datetime, interval_seconds: int) -> datetime:
    return base + timedelta(seconds=max(interval_seconds, 1))


def _create_job_for_trigger(session: Session, trigger: Trigger, queue_item_ids: Optional[List[int]] = None) -> Optional[Job]:
    proc = session.exec(select(Process).where(Process.id == trigger.process_id)).first()
    if not proc:
        raise ValueError("Process not found for trigger")
    pkg = session.exec(select(Package).where(Package.id == proc.package_id)).first() if proc.package_id else None
    qids_json = json.dumps(queue_item_ids) if queue_item_ids else None
    j = Job(
        process_id=proc.id,
        package_id=proc.package_id,
        package_name=(pkg.name if pkg else None),
        package_version=(pkg.version if pkg else None),
        entrypoint_name=getattr(proc, "entrypoint_name", None),
        source="TRIGGER",
        trigger_id=trigger.id,
        queue_item_ids=qids_json,
        robot_id=trigger.robot_id,
        status="pending",
        parameters=None,
        created_at=iso(now_utc()),
        started_at=None,
        finished_at=None,
    )
    session.add(j)
    session.flush()
    session.refresh(j)
    session.add(
        JobExecutionLog(
            job_execution_id=j.execution_id,
            timestamp=now_utc(),
            level="INFO",
            message=f"Trigger {trigger.id} fired",
        )
    )
    return j


class TriggerScheduler:
    def __init__(self, db_engine, interval_seconds: int = 30):
        self.engine = db_engine
        self.interval = interval_seconds
        self._task: Optional[asyncio.Task] = None
        self._stopped = False

    def start(self):
        if self._task and not self._task.done():
            return
        self._stopped = False
        self._task = asyncio.create_task(self._run(), name="trigger-scheduler")

    async def stop(self):
        self._stopped = True
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except Exception:
                pass

    async def _run(self):
        while not self._stopped:
            try:
                await self._tick()
            except Exception as e:
                log.exception("Trigger scheduler tick failed: %s", e)
            await asyncio.sleep(self.interval)

    async def _tick(self):
        now = now_utc()
        with Session(self.engine) as session:
            triggers = session.exec(
                select(Trigger).where(Trigger.enabled == True).where(Trigger.type == TriggerType.TIME)
            ).all()
            for t in triggers:
                if not t.cron_expression:
                    continue
                due_at = _parse_dt(t.next_fire_at) if hasattr(t, "next_fire_at") else None
                if due_at is None:
                    # compute initial next_fire_at
                    t.next_fire_at = iso(_next_fire(t.cron_expression, getattr(t, "timezone", None), now))
                    session.add(t)
                    session.commit()
                    session.refresh(t)
                    due_at = _parse_dt(t.next_fire_at)
                if due_at and now >= due_at:
                    try:
                        _create_job_for_trigger(session, t)
                        t.last_fired_at = iso(now)
                        t.next_fire_at = iso(_next_fire(t.cron_expression, getattr(t, "timezone", None), due_at))
                        session.add(t)
                        session.commit()
                        session.refresh(t)
                    except Exception as e:
                        session.rollback()
                        log.error("Failed to fire trigger %s: %s", t.id, e)
                        # leave next_fire_at unchanged to retry next tick

            queue_triggers = session.exec(
                select(Trigger).where(Trigger.enabled == True).where(Trigger.type == TriggerType.QUEUE)
            ).all()
            for t in queue_triggers:
                interval = int(t.polling_interval or self.interval)
                due_at = _parse_dt(t.next_fire_at) if hasattr(t, "next_fire_at") else None
                if due_at is None:
                    t.next_fire_at = iso(now)
                    session.add(t)
                    session.commit()
                    session.refresh(t)
                    due_at = _parse_dt(t.next_fire_at)
                if due_at and now < due_at:
                    continue
                if not t.queue_id:
                    # cannot poll without queue
                    t.next_fire_at = iso(_next_poll(now, interval))
                    session.add(t)
                    session.commit()
                    session.refresh(t)
                    continue
                batch_size = int(t.batch_size or 1)
                try:
                    items = (
                        session.exec(
                            select(QueueItem)
                            .where(QueueItem.queue_id == t.queue_id)
                            .where(QueueItem.status.in_(["NEW", "new"]))
                            .order_by(QueueItem.id)
                            .limit(batch_size)
                        ).all()
                    )
                    if not items:
                        t.last_fired_at = iso(now)
                        t.next_fire_at = iso(_next_poll(now, interval))
                        session.add(t)
                        session.commit()
                        session.refresh(t)
                        continue
                    for qi in items:
                        qi.status = "IN_PROGRESS"
                        qi.updated_at = iso(now)
                        session.add(qi)
                    session.flush()
                    claimed_ids = [qi.id for qi in items]
                    job = _create_job_for_trigger(session, t, queue_item_ids=claimed_ids)
                    for qi in items:
                        qi.job_id = job.id
                        qi.updated_at = iso(now)
                        session.add(qi)
                    t.last_fired_at = iso(now)
                    t.next_fire_at = iso(_next_poll(now, interval))
                    session.add(t)
                    session.commit()
                    session.refresh(t)
                except Exception as e:
                    session.rollback()
                    log.error("Failed to process queue trigger %s: %s", t.id, e)


scheduler = TriggerScheduler(engine)
