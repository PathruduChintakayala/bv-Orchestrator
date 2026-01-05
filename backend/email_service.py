import logging
import smtplib
import threading
from dataclasses import dataclass
from email.message import EmailMessage
from typing import List, Optional, Sequence
from sqlmodel import Session, select

from backend.models import Setting
from backend.logging_utils import backend_logger


@dataclass
class EmailConfig:
    enabled: bool = False
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_username: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_use_tls: bool = False
    smtp_use_ssl: bool = False
    from_address: Optional[str] = None


class EmailService:
    def __init__(self, session: Session):
        self.session = session
        self.log = logging.getLogger("email")

    def _parse(self, value: str, type_: str):
        if value is None:
            return None
        if type_ == "int":
            try:
                return int(value)
            except Exception:
                return None
        if type_ == "bool":
            return str(value).lower() in ("1", "true", "yes", "on")
        if type_ == "json":
            try:
                import json
                return json.loads(value)
            except Exception:
                return None
        return value

    def _load_config(self) -> EmailConfig:
        cfg = EmailConfig()
        rows = self.session.exec(select(Setting).where(Setting.key.like("email.%"))).all()
        for row in rows:
            suffix = row.key.split(".", 1)[1] if "." in row.key else row.key
            parsed = self._parse(row.value, row.type)
            if hasattr(cfg, suffix):
                setattr(cfg, suffix, parsed)
        return cfg

    def _build_message(self, cfg: EmailConfig, subject: str, body: str, recipients: Sequence[str]) -> EmailMessage:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = cfg.from_address or ""
        msg["To"] = ", ".join(recipients)
        msg.set_content(body)
        return msg

    def send_email(self, subject: str, body: str, to_addresses: Optional[Sequence[Optional[str]]] = None, background_tasks: Optional[object] = None) -> bool:
        cfg = self._load_config()
        if not cfg.enabled:
            backend_logger.info("Email delivery disabled; skip", context="email_service")
            return False
        if not cfg.smtp_host:
            backend_logger.warn("SMTP host missing; skip email", context="email_service")
            return False
        if cfg.smtp_use_tls and cfg.smtp_use_ssl:
            backend_logger.warn("Both TLS and SSL set; refusing to send", context="email_service")
            return False
        recipients: List[str] = [addr for addr in (to_addresses or []) if addr]
        if not recipients and cfg.from_address:
            recipients.append(cfg.from_address)
        if not recipients:
            backend_logger.warn("No recipient found for email notification", context="email_service")
            return False
        if not cfg.from_address:
            backend_logger.warn("from_address missing; cannot build message", context="email_service")
            return False

        port = cfg.smtp_port or (465 if cfg.smtp_use_ssl else 587)
        message = self._build_message(cfg, subject, body, recipients)

        def _deliver():
            try:
                smtp_cls = smtplib.SMTP_SSL if cfg.smtp_use_ssl else smtplib.SMTP
                with smtp_cls(cfg.smtp_host, port, timeout=15) as smtp:
                    if cfg.smtp_use_tls and not cfg.smtp_use_ssl:
                        smtp.starttls()
                    if cfg.smtp_username:
                        smtp.login(cfg.smtp_username, cfg.smtp_password or "")
                    smtp.send_message(message)
                backend_logger.info("Email sent", context="email_service", subject=subject)
            except Exception as exc:
                backend_logger.error("Email send failed", context="email_service", error=str(exc))

        if background_tasks is not None:
            try:
                background_tasks.add_task(_deliver)
            except Exception:
                # Fallback to thread if BackgroundTasks not available
                threading.Thread(target=_deliver, daemon=True).start()
        else:
            threading.Thread(target=_deliver, daemon=True).start()
        return True
