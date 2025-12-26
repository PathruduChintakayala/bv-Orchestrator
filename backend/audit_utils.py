from typing import Any, Dict, Optional
from datetime import datetime
import json
from fastapi import Request
from sqlmodel import Session

from .models import AuditEvent, User


REDACT_KEYS = {
    "password",
    "secret",
    "token",
    "api_key",
    "apikey",
    "smtp.password",
    "smtp_password",
}


def utcnow_iso() -> str:
    return datetime.utcnow().isoformat()


def _redact_value(key: str, value: Any) -> Any:
    k = key.lower()
    if any(rk in k for rk in REDACT_KEYS):
        return "***redacted***"
    return value


def redact(obj: Any) -> Any:
    try:
        if isinstance(obj, dict):
            return {k: redact(_redact_value(k, v)) for k, v in obj.items()}
        if isinstance(obj, list):
            return [redact(v) for v in obj]
        return obj
    except Exception:
        return obj


def safe_json_dumps(data: Any) -> str:
    try:
        return json.dumps(data)
    except Exception:
        try:
            return json.dumps(str(data))
        except Exception:
            return "{}"


def diff_dicts(before: Dict[str, Any], after: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    changes: Dict[str, Dict[str, Any]] = {}
    keys = set(before.keys()) | set(after.keys())
    for k in sorted(keys):
        bv = before.get(k)
        av = after.get(k)
        if bv != av:
            changes[k] = {"from": bv, "to": av}
    return changes


def log_event(
    session: Session,
    *,
    action: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    entity_name: Optional[str] = None,
    before: Optional[Dict[str, Any]] = None,
    after: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    request: Optional[Request] = None,
    user: Optional[User] = None,
    actor_username: Optional[str] = None,
    system: bool = False,
) -> Optional[int]:
    try:
        ip = None
        ua = None
        if request is not None:
            try:
                ip = request.client.host if request.client else None
            except Exception:
                ip = None
            try:
                ua = request.headers.get("user-agent")
            except Exception:
                ua = None

        actor_id = None
        actor_name = None
        if user is not None:
            actor_id = getattr(user, "id", None)
            actor_name = getattr(user, "username", None)
        if actor_username:
            actor_name = actor_username

        evt = AuditEvent(
            timestamp=utcnow_iso(),
            actor_user_id=actor_id,
            actor_username=actor_name,
            ip_address=ip,
            user_agent=ua,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            entity_name=entity_name,
            before_data=safe_json_dumps(redact(before)) if before is not None else None,
            after_data=safe_json_dumps(redact(after)) if after is not None else None,
            details=safe_json_dumps(redact(metadata)) if metadata is not None else None,
        )
        session.add(evt)
        session.commit()
        session.refresh(evt)
        return evt.id
    except Exception:
        # Do not break the main flow on audit failures
        return None
