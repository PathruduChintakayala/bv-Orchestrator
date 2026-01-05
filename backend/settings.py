from typing import Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from sqlmodel import Session, select
from datetime import datetime
import json
from pydantic import BaseModel

from backend.db import get_session
from backend.auth import get_current_user
from backend.permissions import require_permission
from backend.models import Setting, RolePermission, UserRole, User
from backend.audit_utils import log_event, diff_dicts
from backend.email_service import EmailService
from backend.timezone_utils import get_display_timezone, to_display_iso

router = APIRouter(prefix="/settings", tags=["settings"])  # mounted under /api

ALLOWED_GROUPS = {"general", "security", "jobs", "email", "logging"}
DEFAULT_TIMEZONE = "UTC"
SECRET_MASK = "********"


def utcnow_iso() -> str:
    return datetime.utcnow().isoformat()


def _has_permission(session: Session, user: User, artifact: str, perm: str) -> bool:
    if not user:
        return False
    if getattr(user, "is_admin", False):
        return True
    uid = getattr(user, "id", None)
    if not uid:
        return False
    urs = session.exec(select(UserRole).where(UserRole.user_id == uid)).all()
    role_ids = [ur.role_id for ur in urs]
    if not role_ids:
        return False
    rps = session.exec(select(RolePermission).where(RolePermission.role_id.in_(role_ids), RolePermission.artifact == artifact)).all()
    for rp in rps:
        if perm == "view" and rp.can_view:
            return True
        if perm == "edit" and rp.can_edit:
            return True
        if perm == "create" and rp.can_create:
            return True
        if perm == "delete" and rp.can_delete:
            return True
    return False


def _parse_value(value: str, type_: str):
    try:
        if type_ == "int":
            return int(value)
        if type_ == "bool":
            return value.lower() in ("1", "true", "yes", "on")
        if type_ == "json":
            return json.loads(value)
        return value
    except Exception:
        return value


def _serialize_value(val: Any, type_: str) -> str:
    if val is None:
        return ""
    if type_ == "int":
        return str(int(val))
    if type_ == "bool":
        return "true" if bool(val) else "false"
    if type_ == "json":
        return json.dumps(val)
    return str(val)


def _group_from_key(key: str) -> str:
    return key.split(".", 1)[0] if "." in key else key


def _build_group_payload(session: Session, group: str) -> Dict[str, Any]:
    data: Dict[str, Any] = {}
    rows = session.exec(select(Setting).where(Setting.key.like(f"{group}.%"))).all()
    for s in rows:
        suffix = s.key.split(".", 1)[1] if "." in s.key else s.key
        data[suffix] = _parse_value(s.value, s.type)
    if group == "general" and "timezone" not in data:
        data["timezone"] = DEFAULT_TIMEZONE
    if group == "security":
        data.setdefault("max_failed_logins", 5)
        data.setdefault("lockout_minutes", 15)
    if group == "email":
        data.setdefault("enabled", False)
        data.setdefault("smtp_use_tls", False)
        data.setdefault("smtp_use_ssl", False)
        has_pw = bool(data.get("smtp_password"))
        if has_pw:
            data["smtp_password"] = SECRET_MASK
        else:
            data["smtp_password"] = ""
        data["smtp_password_set"] = has_pw
    return data


@router.get("")
def get_all_settings(session: Session = Depends(get_session), user: User = Depends(get_current_user), _perm: bool = Depends(require_permission("settings", "view"))):
    payload: Dict[str, Any] = {}
    for grp in ALLOWED_GROUPS:
        payload[grp] = _build_group_payload(session, grp)
    return payload


@router.get("/{group}")
def get_settings_group(group: str, session: Session = Depends(get_session), user: User = Depends(get_current_user), _perm: bool = Depends(require_permission("settings", "view"))):
    if group not in ALLOWED_GROUPS:
        raise HTTPException(status_code=400, detail="Unknown settings group")
    return _build_group_payload(session, group)


@router.put("/{group}")
def update_settings_group(group: str, payload: Dict[str, Any], request: Request, session: Session = Depends(get_session), user: User = Depends(get_current_user), _perm: bool = Depends(require_permission("settings", "edit"))):
    if group not in ALLOWED_GROUPS:
        raise HTTPException(status_code=400, detail="Unknown settings group")

    if group == "email":
        enabled = bool(payload.get("enabled", False))
        host = payload.get("smtp_host")
        port = payload.get("smtp_port")
        from_address = payload.get("from_address")
        use_tls = bool(payload.get("smtp_use_tls", False))
        use_ssl = bool(payload.get("smtp_use_ssl", False))
        if use_tls and use_ssl:
            raise HTTPException(status_code=400, detail="Choose either TLS or SSL, not both")
        if enabled:
            missing = []
            if not host:
                missing.append("smtp_host")
            if port in (None, ""):
                missing.append("smtp_port")
            if not from_address:
                missing.append("from_address")
            if missing:
                raise HTTPException(status_code=400, detail=f"Missing required fields when email is enabled: {', '.join(missing)}")

    # Load existing for before/after diff
    before = _build_group_payload(session, group)

    # Basic validation per group (lightweight; can expand):
    if group == "security":
        pass
    # Persist provided keys with inferred types (simple heuristics for now)
    uid = getattr(user, "id", None)
    for key, val in payload.items():
        full_key = f"{group}.{key}" if not key.startswith(f"{group}.") else key
        # Infer type if setting not present, else reuse existing type
        s = session.exec(select(Setting).where(Setting.key == full_key)).first()
        if group == "email" and key == "smtp_password" and isinstance(val, str) and val.strip() == SECRET_MASK and s is not None:
            # Keep existing secret if mask is sent back
            continue
        if s is None:
            # Infer type
            if isinstance(val, bool):
                t = "bool"
            elif isinstance(val, int):
                t = "int"
            elif isinstance(val, (dict, list)):
                t = "json"
            else:
                t = "string"
            s = Setting(key=full_key, value=_serialize_value(val, t), type=t, scope="global", updated_by_user_id=uid, updated_at=utcnow_iso())
            session.add(s)
        else:
            s.value = _serialize_value(val, s.type)
            s.updated_by_user_id = uid
            s.updated_at = utcnow_iso()
            session.add(s)
    session.commit()

    after = _build_group_payload(session, group)
    changes = diff_dicts(before, after)

    # Emit audit event for settings update
    log_event(
        session,
        action="setting.update",
        entity_type="setting",
        entity_id=group,
        entity_name=group,
        before=before,
        after=after,
        metadata={"changed_keys": list(changes.keys()), "diff": changes},
        request=request,
        user=user,
    )

    return after


class TestEmailRequest(BaseModel):
    to: Optional[str] = None


@router.post("/email/test")
def send_test_email(payload: TestEmailRequest, background_tasks: BackgroundTasks, session: Session = Depends(get_session), user: User = Depends(get_current_user), _perm: bool = Depends(require_permission("settings", "view"))):
    svc = EmailService(session)
    tz = get_display_timezone(session)
    target = payload.to or getattr(user, "email", None)
    if not target:
        # fallback to from_address inside service if present
        target = None
    subject = "BV Orchestrator: Test Email"
    body = (
        "This is a test notification from BV Orchestrator.\n\n"
        f"Sent at: {to_display_iso(utcnow_iso(), tz)}\n"
        f"User: {getattr(user, 'username', 'unknown')}\n"
    )
    ok = svc.send_email(subject=subject, body=body, to_addresses=[target] if target else None, background_tasks=background_tasks)
    if not ok:
        raise HTTPException(status_code=400, detail="Email delivery is disabled or not configured")
    return {"status": "queued"}
