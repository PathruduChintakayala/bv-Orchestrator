from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence, Tuple

from jinja2 import Environment, select_autoescape
from sqlmodel import Session, select

from backend.models import Setting


@dataclass
class EmailContent:
    subject: str
    text_body: str
    html_body: str


_env = Environment(
    autoescape=select_autoescape(enabled_extensions=("html",), default_for_string=True),
    trim_blocks=True,
    lstrip_blocks=True,
)

_BASE_HTML = _env.from_string(
    """
<!DOCTYPE html>
<html lang=\"en\">
<head>
  <meta charset=\"UTF-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />
  <title>{{ subject }}</title>
</head>
<body style=\"margin:0;background:#f5f6f8;padding:24px;font-family:'Segoe UI',Arial,sans-serif;color:#111827;\">
  <div style=\"max-width:640px;margin:0 auto;\">
    <div style=\"text-align:center;font-weight:700;font-size:20px;letter-spacing:0.2px;margin-bottom:12px;\">BV Orchestrator</div>
    <div style=\"background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:24px;\">
      <p style=\"margin:0 0 12px 0;font-size:15px;line-height:22px;\">{{ intro }}</p>
      {% if body_lines %}
        {% for line in body_lines %}
          <p style=\"margin:0 0 12px 0;font-size:15px;line-height:22px;\">{{ line }}</p>
        {% endfor %}
      {% endif %}
      {% if metadata %}
        <div style=\"margin:16px 0;padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;\">
          {% for label, value in metadata %}
            <div style=\"display:flex;justify-content:space-between;font-size:14px;line-height:20px;margin-bottom:6px;gap:12px;\">
              <span style=\"color:#6b7280;\">{{ label }}</span>
              <span style=\"color:#111827;font-weight:600;text-align:right;\">{{ value }}</span>
            </div>
          {% endfor %}
        </div>
      {% endif %}
      {% if cta_url %}
        <div style=\"text-align:center;margin:22px 0 14px;\">
          <a href=\"{{ cta_url }}\" style=\"display:inline-block;padding:12px 18px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;border-radius:10px;\">{{ cta_label or 'Open BV Orchestrator' }}</a>
        </div>
        <p style=\"margin:0 0 8px;font-size:13px;color:#6b7280;text-align:center;\">If the button does not work, copy and paste this link:</p>
        <p style=\"margin:0;font-size:13px;color:#2563eb;word-break:break-all;text-align:center;\">{{ cta_url }}</p>
      {% endif %}
      {% if footer_note %}
        <p style=\"margin:20px 0 0;font-size:13px;line-height:19px;color:#6b7280;\">{{ footer_note }}</p>
      {% endif %}
    </div>
    <p style=\"margin:14px 0 0;font-size:12px;color:#9ca3af;text-align:center;\">This is an automated message from BV Orchestrator.</p>
  </div>
</body>
</html>
"""
)


def resolve_ui_base_url(session: Session, request: Optional[object] = None) -> str:
    base = None
    try:
        row = session.exec(select(Setting).where(Setting.key == "general.ui_base_url")).first()
        if row and row.value:
            base = str(row.value).strip()
    except Exception:
        base = None
    if not base:
        try:
            row = session.exec(select(Setting).where(Setting.key == "general.ui_url")).first()
            if row and row.value:
                base = str(row.value).strip()
        except Exception:
            base = None
    if not base:
        base = os.getenv("BV_UI_URL") or os.getenv("UI_BASE_URL")
    if not base and request is not None:
        try:
            base = f"{str(request.base_url).rstrip('/')}/#"
        except Exception:
            base = None
    return (base or "").rstrip("/")


def build_ui_link(base_url: str, path: str) -> str:
    base = (base_url or "").rstrip("/")
    path_only = (path or "").lstrip("/")
    if not base:
        return f"/{path_only}"
    return f"{base}/{path_only}"


def _safe_text(value: Optional[object], *, max_len: int = 240) -> str:
    if value is None:
        return "n/a"
    text = str(value).replace("\r", " ").replace("\n", " ").strip()
    if len(text) > max_len:
        return text[: max_len - 3].rstrip() + "..."
    return text


def _render(text_intro: str, subject: str, body_lines: Sequence[str], *, metadata: Optional[Sequence[Tuple[str, str]]] = None, cta_url: Optional[str] = None, cta_label: Optional[str] = None, footer_note: Optional[str] = None) -> EmailContent:
    ctx = {
        "subject": subject,
        "intro": text_intro,
        "body_lines": [line for line in body_lines if line],
        "metadata": [(k, v) for (k, v) in (metadata or []) if k and v],
        "cta_url": cta_url,
        "cta_label": cta_label,
        "footer_note": footer_note,
    }
    html_body = _BASE_HTML.render(**ctx)
    text_parts: List[str] = [ctx["intro"]]
    if ctx["body_lines"]:
        text_parts.extend(ctx["body_lines"])
    if ctx["metadata"]:
        text_parts.append("")
        text_parts.extend([f"{label}: {value}" for label, value in ctx["metadata"]])
    if ctx["cta_url"]:
        text_parts.append("")
        text_parts.append(f"{ctx.get('cta_label') or 'Open BV Orchestrator'}: {ctx['cta_url']}")
    if ctx["footer_note"]:
        text_parts.append("")
        text_parts.append(ctx["footer_note"])
    text_body = "\n".join([p for p in text_parts if p is not None])
    return EmailContent(subject=subject, text_body=text_body, html_body=html_body)


def render_invite_email(*, ui_base_url: str, token: str, expires_at_display: Optional[str], timezone: Optional[str], expires_in_hours: Optional[int] = None) -> EmailContent:
    link = build_ui_link(ui_base_url, f"accept-invite/{token}")
    subject = "You've been invited to BV Orchestrator"
    hours = expires_in_hours or 48
    expiry_line = f"This invitation expires in {hours} hours."
    if expires_at_display:
        tz_suffix = f" ({timezone})" if timezone else ""
        expiry_line = f"This invitation expires in {hours} hours, by {expires_at_display}{tz_suffix}."
    body_lines = [
        "You have been invited to join BV Orchestrator.",
        "Use the button below to accept your invitation and set up your account.",
        expiry_line,
    ]
    return _render(
        "Welcome to BV Orchestrator",
        subject,
        body_lines,
        cta_url=link,
        cta_label="Accept Invitation",
        footer_note="If you did not expect this invitation, you can ignore this email.",
    )


def render_password_reset_email(*, ui_base_url: str, token: str, expires_at_display: Optional[str], timezone: Optional[str], initiated_by_admin: bool = False) -> EmailContent:
    link = build_ui_link(ui_base_url, f"reset-password/{token}")
    subject = "Reset your BV Orchestrator password"
    intro = "A password reset was requested for your BV Orchestrator account."
    if initiated_by_admin:
        intro = "An administrator requested a password reset for your BV Orchestrator account."
    expiry_line = "This link expires in 30 minutes."
    if expires_at_display:
        tz_suffix = f" ({timezone})" if timezone else ""
        expiry_line = f"This link expires in 30 minutes, by {expires_at_display}{tz_suffix}."
    body_lines = [
        intro,
        "If you did not request this, you can ignore this email and your password will stay the same.",
        expiry_line,
    ]
    return _render(
        "Password reset",
        subject,
        body_lines,
        cta_url=link,
        cta_label="Reset Password",
        footer_note="For security, this link can be used only once.",
    )


def render_alert_email(*, alert_type: str, entity_name: str, occurred_at: str, metadata: Optional[Iterable[Tuple[str, str]]] = None, ui_base_url: Optional[str] = None, cta_path: Optional[str] = None) -> EmailContent:
    subject = f"{alert_type}: {entity_name}"
    cta_url = build_ui_link(ui_base_url or "", cta_path) if cta_path else None
    meta_pairs = [(label, _safe_text(value)) for label, value in (metadata or []) if label and value is not None]
    body_lines = [
        "An alert was raised in BV Orchestrator.",
        f"Type: {alert_type}",
        f"Entity: {entity_name}",
        f"Time: {occurred_at}",
    ]
    footer = "Do not share this email. It contains operational context only."
    return _render(
        "System alert",
        subject,
        body_lines,
        metadata=meta_pairs,
        cta_url=cta_url,
        cta_label="Open in BV Orchestrator" if cta_url else None,
        footer_note=footer,
    )
