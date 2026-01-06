from typing import Optional, Sequence
from sqlmodel import Session, select

from backend.email_service import EmailService
from backend.email_templates import render_alert_email, resolve_ui_base_url
from backend.models import Job, Process, Robot, Trigger, Queue, QueueItem
from backend.timezone_utils import get_display_timezone, to_display_iso


class NotificationService:
    def __init__(self, session: Session):
        self.session = session
        self.email = EmailService(session)
        self._tz_cache: Optional[str] = None
        self._ui_cache: Optional[str] = None

    def _tz(self) -> str:
        if self._tz_cache is None:
            self._tz_cache = get_display_timezone(self.session)
        return self._tz_cache

    def _ui_base(self) -> str:
        if self._ui_cache is None:
            self._ui_cache = resolve_ui_base_url(self.session)
        return self._ui_cache

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
        proc_name = self._process_name(getattr(job, "process_id", None))
        when = self._ts(getattr(job, "finished_at", None) or getattr(job, "updated_at", None) or getattr(job, "created_at", None))
        error_summary = getattr(job, "error_message", None)
        metadata = [
            ("Job ID", str(getattr(job, "id", ""))),
            ("Process", proc_name or str(getattr(job, "process_id", ""))),
            ("Triggered by", getattr(job, "source", None) or "unknown"),
            ("Status", getattr(job, "status", None) or "failed"),
            ("Finished at", when),
        ]
        if error_summary:
            metadata.append(("Error", error_summary))
        content = render_alert_email(
            alert_type="Job failed",
            entity_name=proc_name or f"Job {getattr(job, 'id', '')}",
            occurred_at=when,
            metadata=metadata,
            ui_base_url=self._ui_base(),
            cta_path=f"automations/jobs?jobId={getattr(job, 'id', '')}",
        )
        self.email.send_email(
            subject=content.subject,
            body=content.text_body,
            html_body=content.html_body,
            to_addresses=None,
            background_tasks=background_tasks,
        )

    def notify_robot_offline(self, robot: Robot, background_tasks=None) -> None:
        when = self._ts(getattr(robot, "last_heartbeat", None) or getattr(robot, "updated_at", None))
        metadata = [
            ("Robot", getattr(robot, "name", "unknown")),
            ("Last heartbeat", when),
        ]
        content = render_alert_email(
            alert_type="Robot offline",
            entity_name=getattr(robot, "name", "Robot"),
            occurred_at=when,
            metadata=metadata,
            ui_base_url=self._ui_base(),
            cta_path=f"robots?robotId={getattr(robot, 'id', '')}",
        )
        self.email.send_email(
            subject=content.subject,
            body=content.text_body,
            html_body=content.html_body,
            to_addresses=None,
            background_tasks=background_tasks,
        )

    def notify_trigger_failure(self, trigger: Trigger, error: str, background_tasks=None) -> None:
        when = self._ts(getattr(trigger, "updated_at", None))
        metadata = [
            ("Trigger", getattr(trigger, "name", "")),
            ("Type", getattr(trigger, "type", "")),
            ("Process ID", str(getattr(trigger, "process_id", ""))),
            ("Error", error),
        ]
        content = render_alert_email(
            alert_type="Trigger failed",
            entity_name=getattr(trigger, "name", "Trigger"),
            occurred_at=when,
            metadata=metadata,
            ui_base_url=self._ui_base(),
            cta_path=f"automations/triggers?triggerId={getattr(trigger, 'id', '')}",
        )
        self.email.send_email(
            subject=content.subject,
            body=content.text_body,
            html_body=content.html_body,
            to_addresses=None,
            background_tasks=background_tasks,
        )

    def notify_queue_item_failed(self, item: QueueItem, queue: Optional[Queue], background_tasks=None) -> None:
        queue_name = queue.name if queue else getattr(item, "queue_id", None)
        metadata = [
            ("Queue", str(queue_name)),
            ("Item ID", getattr(item, "id", "")),
            ("Reference", getattr(item, "reference", None) or "n/a"),
            ("Retries", str(getattr(item, "retries", ""))),
            ("Updated at", self._ts(getattr(item, "updated_at", None))),
        ]
        last_error = getattr(item, "error_reason", None)
        if last_error:
            metadata.append(("Last error", last_error))
        content = render_alert_email(
            alert_type="Queue item failed",
            entity_name=f"Queue {queue_name}",
            occurred_at=self._ts(getattr(item, "updated_at", None)),
            metadata=metadata,
            ui_base_url=self._ui_base(),
            cta_path=f"queue-items?queueId={getattr(item, 'queue_id', '')}",
        )
        self.email.send_email(
            subject=content.subject,
            body=content.text_body,
            html_body=content.html_body,
            to_addresses=None,
            background_tasks=background_tasks,
        )
