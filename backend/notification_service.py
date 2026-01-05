from typing import Optional, Sequence
from sqlmodel import Session, select

from backend.email_service import EmailService
from backend.models import Job, Process, Robot, Trigger, Queue, QueueItem
from backend.timezone_utils import get_display_timezone, to_display_iso


class NotificationService:
    def __init__(self, session: Session):
        self.session = session
        self.email = EmailService(session)
        self._tz_cache: Optional[str] = None

    def _tz(self) -> str:
        if self._tz_cache is None:
            self._tz_cache = get_display_timezone(self.session)
        return self._tz_cache

    def _ts(self, value: Optional[str]) -> str:
        return to_display_iso(value, self._tz()) or "n/a"

    def _process_name(self, process_id: Optional[int]) -> Optional[str]:
        if not process_id:
            return None
        proc = self.session.exec(select(Process).where(Process.id == process_id)).first()
        return proc.name if proc else None

    def _queue_name(self, queue_id: Optional[int]) -> Optional[str]:
        if not queue_id:
            return None
        q = self.session.exec(select(Queue).where(Queue.id == queue_id)).first()
        return q.name if q else None

    def notify_job_failed(self, job: Job, background_tasks=None) -> None:
        subject = f"[BV] Job failed: {job.id}"
        proc_name = self._process_name(getattr(job, "process_id", None))
        when = self._ts(getattr(job, "finished_at", None) or getattr(job, "updated_at", None) or getattr(job, "created_at", None))
        body = (
            f"Job {job.id} failed.\n"
            f"Process: {proc_name or job.process_id}\n"
            f"Triggered by: {getattr(job, 'source', None) or 'unknown'}\n"
            f"Error: {getattr(job, 'error_message', None) or 'n/a'}\n"
            f"Finished at: {when}\n"
        )
        self.email.send_email(subject=subject, body=body, to_addresses=None, background_tasks=background_tasks)

    def notify_robot_offline(self, robot: Robot, background_tasks=None) -> None:
        when = self._ts(getattr(robot, "last_heartbeat", None) or getattr(robot, "updated_at", None))
        subject = f"[BV] Robot offline: {robot.name}"
        body = (
            f"Robot {robot.name} is offline.\n"
            f"Last heartbeat: {when}\n"
        )
        self.email.send_email(subject=subject, body=body, to_addresses=None, background_tasks=background_tasks)

    def notify_trigger_failure(self, trigger: Trigger, error: str, background_tasks=None) -> None:
        subject = f"[BV] Trigger failed: {trigger.name}"
        body = (
            f"Trigger {trigger.name} ({trigger.id}) failed.\n"
            f"Type: {trigger.type}\n"
            f"Process ID: {trigger.process_id}\n"
            f"Error: {error}\n"
        )
        self.email.send_email(subject=subject, body=body, to_addresses=None, background_tasks=background_tasks)

    def notify_queue_item_failed(self, item: QueueItem, queue: Optional[Queue], background_tasks=None) -> None:
        queue_name = queue.name if queue else getattr(item, "queue_id", None)
        subject = f"[BV] Queue item failed after retries"
        body = (
            f"Queue item {item.id} in queue {queue_name} failed after max retries.\n"
            f"Reference: {getattr(item, 'reference', None) or 'n/a'}\n"
            f"Retries: {getattr(item, 'retries', None)}\n"
            f"Last error: {getattr(item, 'error_message', None) or 'n/a'}\n"
            f"Updated at: {self._ts(getattr(item, 'updated_at', None))}\n"
        )
        self.email.send_email(subject=subject, body=body, to_addresses=None, background_tasks=background_tasks)
