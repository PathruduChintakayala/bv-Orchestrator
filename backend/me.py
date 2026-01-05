import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select

from backend.db import get_session
from backend.auth import (
    _utcnow,
    create_access_token,
    get_current_user,
    get_password_hash,
    verify_password,
)
from backend.models import Role, User, UserRole
from backend.audit_utils import diff_dicts, log_event
from backend.timezone_utils import get_display_timezone, to_display_iso

router = APIRouter(prefix="/me", tags=["me"])


def _load_preferences(raw: Optional[object]) -> Dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
        return {}
    except Exception:
        return {}


def _dump_preferences(prefs: Dict[str, Any]) -> str:
    try:
        return json.dumps(prefs)
    except Exception:
        return "{}"


def _user_roles(session: Session, user: User) -> List[str]:
    urs = session.exec(select(UserRole).where(UserRole.user_id == user.id)).all()
    role_ids = [ur.role_id for ur in urs]
    if not role_ids:
        return []
    roles = session.exec(select(Role).where(Role.id.in_(role_ids))).all()
    return [r.name for r in roles if r]


def _user_status(user: User) -> str:
    if not getattr(user, "is_active", True):
        return "disabled"
    if getattr(user, "locked_until", None) and user.locked_until > _utcnow():
        return "locked"
    return "active"


def _profile_payload(session: Session, user: User) -> Dict[str, Any]:
    tz = get_display_timezone(session)
    prefs = _load_preferences(getattr(user, "preferences_json", None))
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "display_name": getattr(user, "full_name", None),
        "is_admin": user.is_admin,
        "status": _user_status(user),
        "locked_until": to_display_iso(getattr(user, "locked_until", None), tz),
        "last_login": to_display_iso(getattr(user, "last_login", None), tz),
        "preferences": prefs,
        "roles": _user_roles(session, user),
        "token_version": getattr(user, "token_version", 1) or 1,
        "timezone": tz,
    }


def _validate_password_policy(password: str, user: User):
    if len(password or "") < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long")
    if not any(c.isalpha() for c in password):
        raise HTTPException(status_code=400, detail="Password must include at least one letter")
    if not any(c.isdigit() for c in password):
        raise HTTPException(status_code=400, detail="Password must include at least one number")
    uname = (user.username or "").lower()
    if uname and uname in (password or "").lower():
        raise HTTPException(status_code=400, detail="Password cannot contain your username")


@router.get("")
def get_profile(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return _profile_payload(session, user)


@router.put("")
def update_profile(payload: Dict[str, Any], request: Request, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    display_name = (payload.get("display_name") or payload.get("full_name") or "").strip()
    prefs_in = payload.get("preferences", {})
    if prefs_in is None:
        prefs_in = {}
    if not isinstance(prefs_in, dict):
        raise HTTPException(status_code=400, detail="preferences must be an object")

    before = {
        "display_name": getattr(user, "full_name", None),
        "preferences": _load_preferences(getattr(user, "preferences_json", None)),
    }

    user.full_name = display_name or None
    user.preferences_json = _dump_preferences(prefs_in)
    session.add(user)
    session.commit()
    session.refresh(user)

    after = {
        "display_name": getattr(user, "full_name", None),
        "preferences": prefs_in,
    }

    try:
        log_event(
            session,
            action="USER_PROFILE_UPDATED",
            entity_type="user",
            entity_id=user.id,
            entity_name=user.username,
            before=before,
            after=after,
            metadata=diff_dicts(before, after),
            request=request,
            user=user,
        )
    except Exception:
        pass

    return _profile_payload(session, user)


@router.post("/change-password")
def change_password(payload: Dict[str, Any], request: Request, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    current_password = payload.get("current_password") or payload.get("currentPassword") or ""
    new_password = payload.get("new_password") or payload.get("newPassword") or payload.get("password") or ""

    if not current_password:
        raise HTTPException(status_code=400, detail="Current password is required")
    if not new_password:
        raise HTTPException(status_code=400, detail="New password is required")
    if not verify_password(current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    _validate_password_policy(new_password, user)
    if verify_password(new_password, user.password_hash):
        raise HTTPException(status_code=400, detail="New password must be different from the current password")

    user.password_hash = get_password_hash(new_password)
    user.failed_login_attempts = 0
    user.last_failed_login_at = None
    user.locked_until = None
    user.token_version = (getattr(user, "token_version", 1) or 1) + 1
    session.add(user)
    session.commit()
    session.refresh(user)

    new_token = create_access_token(
        {
            "sub": user.username,
            "is_admin": user.is_admin,
            "token_version": getattr(user, "token_version", 1) or 1,
        }
    )

    try:
        log_event(
            session,
            action="PASSWORD_CHANGED",
            entity_type="user",
            entity_id=user.id,
            entity_name=user.username,
            before=None,
            after=None,
            metadata={"reason": "self_service", "token_version": getattr(user, "token_version", 1)},
            request=request,
            user=user,
        )
    except Exception:
        pass

    return {"status": "ok", "token_version": getattr(user, "token_version", 1), "access_token": new_token}


@router.get("/sessions")
def list_sessions(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    tz = get_display_timezone(session)
    now_display = to_display_iso(_utcnow(), tz)
    return {
        "token_version": getattr(user, "token_version", 1) or 1,
        "last_login": to_display_iso(getattr(user, "last_login", None), tz),
        "sessions": [
            {
                "id": "current",
                "label": "This device",
                "current": True,
                "last_active": now_display,
            }
        ],
    }


@router.post("/logout-others")
def logout_other_sessions(request: Request, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    user.token_version = (getattr(user, "token_version", 1) or 1) + 1
    session.add(user)
    session.commit()
    session.refresh(user)

    new_token = create_access_token(
        {
            "sub": user.username,
            "is_admin": user.is_admin,
            "token_version": getattr(user, "token_version", 1) or 1,
        }
    )

    try:
        log_event(
            session,
            action="SESSIONS_INVALIDATED",
            entity_type="user",
            entity_id=user.id,
            entity_name=user.username,
            before=None,
            after={"token_version": getattr(user, "token_version", 1)},
            metadata={"scope": "self_service"},
            request=request,
            user=user,
        )
    except Exception:
        pass

    return {"status": "ok", "token_version": getattr(user, "token_version", 1), "access_token": new_token}
