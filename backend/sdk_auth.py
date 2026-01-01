from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, delete, select

from backend.auth import create_access_token, get_current_user
from backend.db import get_session
from backend.models import SdkAuthSession, User

router = APIRouter(prefix="/sdk/auth", tags=["sdk-auth"])

SESSION_TTL = timedelta(minutes=5)
SDK_TOKEN_TTL = timedelta(hours=1)


def _utcnow() -> datetime:
    return datetime.utcnow()


def _cleanup_expired(db: Session) -> None:
    now = _utcnow()
    try:
        db.exec(delete(SdkAuthSession).where(SdkAuthSession.expires_at < now))
        db.commit()
    except Exception:
        # best-effort cleanup
        db.rollback()


@router.post("/start")
def start_session(payload: dict, db: Session = Depends(get_session)):
    """Start (or reuse) a pending SDK auth session for a machine."""
    _cleanup_expired(db)

    machine_name = (payload.get("machine_name") or "").strip()
    if not machine_name:
        raise HTTPException(status_code=400, detail="machine_name is required")

    now = _utcnow()

    # One active session per machine: reuse any unexpired pending/confirmed session.
    existing = db.exec(
        select(SdkAuthSession)
        .where(
            SdkAuthSession.machine_name == machine_name,
            SdkAuthSession.status.in_(["pending", "confirmed"]),
            SdkAuthSession.expires_at >= now,
        )
        .order_by(SdkAuthSession.created_at.desc())
    ).first()

    if existing:
        return {"session_id": existing.session_id, "expires_at": existing.expires_at.isoformat()}

    sess = SdkAuthSession(
        session_id=str(uuid.uuid4()),
        machine_name=machine_name,
        status="pending",
        expires_at=now + SESSION_TTL,
        user_id=None,
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)
    return {"session_id": sess.session_id, "expires_at": sess.expires_at.isoformat()}


@router.post("/confirm")
def confirm_session(
    payload: dict,
    db: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Confirm a pending session from the frontend with an authenticated user."""
    _cleanup_expired(db)

    session_id = (payload.get("session_id") or "").strip()
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    sess = db.exec(select(SdkAuthSession).where(SdkAuthSession.session_id == session_id)).first()
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")

    now = _utcnow()
    if sess.expires_at < now or sess.status == "expired":
        sess.status = "expired"
        db.add(sess)
        db.commit()
        return {"status": "expired"}

    # Idempotent confirm: if already confirmed and still valid, treat as success.
    if sess.status == "confirmed":
        # Bind/overwrite user for developer convenience (dev-only flow).
        sess.user_id = user.id
        db.add(sess)
        db.commit()
        return {"status": "ok"}

    if sess.status != "pending":
        raise HTTPException(status_code=409, detail="Session is not pending")

    sess.user_id = user.id
    sess.status = "confirmed"
    db.add(sess)
    db.commit()

    return {"status": "ok"}


@router.get("/status")
def poll_status(session_id: str, db: Session = Depends(get_session)):
    """Poll the session; once confirmed, mint a short-lived SDK JWT and expire the session."""
    _cleanup_expired(db)

    sid = (session_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="session_id is required")

    sess = db.exec(select(SdkAuthSession).where(SdkAuthSession.session_id == sid)).first()
    if not sess:
        # do not leak whether a session existed
        return {"status": "expired"}

    now = _utcnow()
    if sess.expires_at < now or sess.status == "expired":
        sess.status = "expired"
        db.add(sess)
        db.commit()
        return {"status": "expired"}

    if sess.status == "pending":
        return {"status": "pending"}

    if sess.status != "confirmed":
        return {"status": "expired"}

    if not sess.user_id:
        return {"status": "pending"}

    u = db.exec(select(User).where(User.id == sess.user_id)).first()
    if not u:
        sess.status = "expired"
        db.add(sess)
        db.commit()
        return {"status": "expired"}

    token_expires_at = now + SDK_TOKEN_TTL
    sdk_token = create_access_token(
        {
            "sub": u.username,
            "is_admin": bool(getattr(u, "is_admin", False)),
            "auth_type": "sdk",
            "sdk_session_id": sess.session_id,
        },
        expires_delta=SDK_TOKEN_TTL,
    )

    # Sessions are single-use: once we mint a token, immediately expire the session.
    sess.status = "expired"
    sess.expires_at = now
    db.add(sess)
    db.commit()

    return {
        "status": "confirmed",
        "access_token": sdk_token,
        "expires_at": token_expires_at.isoformat(),
        "user": {"id": u.id, "username": u.username},
    }
