from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from datetime import datetime
import json

from backend.db import get_session
from backend.auth import get_current_user
from backend.permissions import require_permission
from backend.models import AuditEvent, RolePermission, UserRole, User

router = APIRouter(prefix="/audit", tags=["audit"])  # mounted under /api


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


def _map_action_type(action: Optional[str]) -> str:
    a = (action or "").lower()
    if a.endswith(".create"):
        return "created"
    if a.endswith(".update"):
        return "modified"
    if a.endswith(".delete"):
        return "deleted"
    if a in ("job.status_change", "queue_item.status_change", "robot.status_change"):
        return "status_changed"
    if a.startswith("login."):
        return "login"
    if a == "logout":
        return "logout"
    return "other"


ENTITY_DISPLAY_MAP = {
    "asset": "Asset",
    "queue": "Queue",
    "queue_item": "Queue Item",
    "user": "User",
    "role": "Role",
    "job": "Job",
    "process": "Process",
    "package": "Package",
}


def _entity_display(entity_type: Optional[str]) -> str:
    if not entity_type:
        return "System"
    return ENTITY_DISPLAY_MAP.get(entity_type, (entity_type[:1].upper() + entity_type[1:]))


def _build_message(evt: AuditEvent) -> str:
    user = evt.actor_username or "System"
    disp = _entity_display(evt.entity_type)
    name = evt.entity_name or (f"#{evt.entity_id}" if evt.entity_id else "")
    a = (evt.action or "").lower()
    md: Dict[str, Any] = {}
    if evt.details:
        try:
            parsed = json.loads(evt.details)
            if isinstance(parsed, dict):
                md = parsed
        except Exception:
            md = {}
    if a.endswith(".create"):
        return f'User {user} created {disp} "{name}".'
    if a.endswith(".update"):
        return f'User {user} modified {disp} "{name}".'
    if a.endswith(".delete"):
        return f'User {user} deleted {disp} "{name}".'
    if a in ("job.status_change", "queue_item.status_change", "robot.status_change"):
        sf = md.get("status_from")
        st = md.get("status_to")
        if sf is not None and st is not None:
            return f'User {user} changed status of {disp} "{name}" from "{sf}" to "{st}".'
        return f'User {user} changed status of {disp} "{name}".'
    if a.startswith("login."):
        return f'User {user} login event ({evt.action}).'
    if a == "logout":
        return f'User {user} logged out.'
    return f'User {user} performed action "{evt.action}" on {disp} "{name}".'


def _event_to_list_item(evt: AuditEvent) -> Dict[str, Any]:
    # Derive a short summary from details if available
    summary = None
    if evt.details:
        try:
            md = json.loads(evt.details)
            if isinstance(md, dict):
                if md.get("status_from") is not None and md.get("status_to") is not None:
                    summary = f"status: {md.get('status_from')} → {md.get('status_to')}"
                elif md.get("message"):
                    summary = str(md.get("message"))
        except Exception:
            pass
    action_type = _map_action_type(evt.action)
    entity_display = _entity_display(evt.entity_type)
    message = _build_message(evt)
    return {
        "id": evt.id,
        "timestamp": evt.timestamp,
        "actor_username": evt.actor_username,
        "action": evt.action,
        "action_type": action_type,
        "entity_type": evt.entity_type,
        "entity_display": entity_display,
        "entity_id": evt.entity_id,
        "entity_name": evt.entity_name,
        "message": message,
        "summary": summary,
    }


@router.get("")
def list_audit_events(
    # legacy params
    from_ts: Optional[str] = Query(default=None, alias="from"),
    to_ts: Optional[str] = Query(default=None, alias="to"),
    user_id: Optional[int] = None,
    username: Optional[str] = None,
    action: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    q: Optional[str] = None,
    # new structured filters
    from_time: Optional[str] = None,
    to_time: Optional[str] = None,
    action_type: Optional[str] = None,
    user: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    _perm: bool = Depends(require_permission("audit", "view")),
):
    # permission enforced by dependency

    if page < 1:
        page = 1
    if page_size < 1:
        page_size = 50
    if page_size > 500:
        page_size = 500

    stmt = select(AuditEvent)

    # time window
    start = from_time or from_ts
    end = to_time or to_ts
    if start:
        stmt = stmt.where(AuditEvent.timestamp >= start)
    if end:
        stmt = stmt.where(AuditEvent.timestamp <= end)
    # actor filters
    if user_id is not None:
        stmt = stmt.where(AuditEvent.actor_user_id == user_id)
    actor = user or username
    if actor:
        like = f"%{actor}%"
        from sqlmodel import or_
        stmt = stmt.where(or_(AuditEvent.actor_username == actor, AuditEvent.actor_username.ilike(like)))
    if action:
        stmt = stmt.where(AuditEvent.action == action)
    if action_type:
        at = action_type
        if at == "created":
            stmt = stmt.where(AuditEvent.action.ilike("%.create"))
        elif at == "modified":
            stmt = stmt.where(AuditEvent.action.ilike("%.update"))
        elif at == "deleted":
            stmt = stmt.where(AuditEvent.action.ilike("%.delete"))
        elif at == "status_changed":
            from sqlmodel import or_
            stmt = stmt.where(or_(AuditEvent.action == "job.status_change", AuditEvent.action == "queue_item.status_change", AuditEvent.action == "robot.status_change"))
        elif at == "login":
            stmt = stmt.where(AuditEvent.action.ilike("login.%"))
        elif at == "logout":
            stmt = stmt.where(AuditEvent.action == "logout")
    if entity_type:
        stmt = stmt.where(AuditEvent.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditEvent.entity_id == entity_id)
    # free text search
    text = search or q
    if text:
        like = f"%{text}%"
        from sqlmodel import or_
        stmt = stmt.where(or_(AuditEvent.entity_name.ilike(like), AuditEvent.details.ilike(like)))

    total = len(session.exec(stmt).all())
    stmt = stmt.order_by(AuditEvent.timestamp.desc()).offset((page - 1) * page_size).limit(page_size)
    rows = session.exec(stmt).all()
    items = [_event_to_list_item(r) for r in rows]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/{event_id}")
def get_audit_event(event_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user), _perm: bool = Depends(require_permission("audit", "view"))):
    # permission enforced by dependency
    evt = session.get(AuditEvent, event_id)
    if not evt:
        raise HTTPException(status_code=404, detail="Audit event not found")
    return {
        "id": evt.id,
        "timestamp": evt.timestamp,
        "actor_user_id": evt.actor_user_id,
        "actor_username": evt.actor_username,
        "ip_address": evt.ip_address,
        "user_agent": evt.user_agent,
        "action": evt.action,
        "entity_type": evt.entity_type,
        "entity_id": evt.entity_id,
        "entity_name": evt.entity_name,
        "before_data": evt.before_data,
        "after_data": evt.after_data,
        "metadata": evt.details,
    }
