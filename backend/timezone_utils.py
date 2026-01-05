from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from sqlmodel import Session, select

from backend.models import Setting

DEFAULT_TIMEZONE = "UTC"


def _safe_zoneinfo(name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(name or DEFAULT_TIMEZONE)
    except Exception:
        return ZoneInfo(DEFAULT_TIMEZONE)


def _to_utc_datetime(value: Optional[object]) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except Exception:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt


def to_display_iso(value: Optional[object], tz_name: Optional[str]) -> Optional[str]:
    dt_utc = _to_utc_datetime(value)
    if not dt_utc:
        return None if value is None else str(value)
    tz = _safe_zoneinfo(tz_name)
    return dt_utc.astimezone(tz).isoformat()


def get_display_timezone(session: Session) -> str:
    row = session.exec(select(Setting).where(Setting.key == "general.timezone")).first()
    if not row or not row.value:
        return DEFAULT_TIMEZONE
    return str(row.value) or DEFAULT_TIMEZONE
