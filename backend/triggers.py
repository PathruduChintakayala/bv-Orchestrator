import uuid
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlmodel import select

from .auth import get_current_user
from .permissions import require_permission
from .db import get_session
from .models import Trigger, TriggerType, Process, Queue
from .audit_utils import log_event

router = APIRouter(prefix="/triggers", tags=["triggers"])


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def to_out(t: Trigger) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "type": t.type,
        "process_id": t.process_id,
        "enabled": t.enabled,
        "robot_id": t.robot_id,
        "cron_expression": t.cron_expression,
        "timezone": t.timezone,
        "last_fired_at": t.last_fired_at,
        "next_fire_at": t.next_fire_at,
        "queue_id": t.queue_id,
        "batch_size": t.batch_size,
        "polling_interval": t.polling_interval,
        "last_processed_item_id": t.last_processed_item_id,
        "created_at": t.created_at,
        "updated_at": t.updated_at,
    }


def _validate_payload(payload: dict, session) -> TriggerType:
    raw_type = (payload.get("type") or "").upper().strip()
    try:
        trigger_type = TriggerType(raw_type)
    except Exception:
        raise HTTPException(status_code=400, detail="type must be TIME or QUEUE")

    process_id = payload.get("process_id")
    if not process_id:
        raise HTTPException(status_code=400, detail="process_id is required")
    proc = session.exec(select(Process).where(Process.id == process_id)).first()
    if not proc:
        raise HTTPException(status_code=404, detail="Process not found")

    if trigger_type == TriggerType.TIME:
        if not payload.get("cron_expression"):
            raise HTTPException(status_code=400, detail="cron_expression is required for TIME triggers")
    if trigger_type == TriggerType.QUEUE:
        qid = payload.get("queue_id")
        if not qid:
            raise HTTPException(status_code=400, detail="queue_id is required for QUEUE triggers")
        q = session.exec(select(Queue).where(Queue.id == qid)).first()
        if not q:
            raise HTTPException(status_code=404, detail="Queue not found")
    return trigger_type


def _apply_updates(t: Trigger, payload: dict, session) -> Trigger:
    if "name" in payload and payload.get("name"):
        t.name = str(payload.get("name")).strip()
    if "process_id" in payload and payload.get("process_id"):
        pid = payload.get("process_id")
        proc = session.exec(select(Process).where(Process.id == pid)).first()
        if not proc:
            raise HTTPException(status_code=404, detail="Process not found")
        t.process_id = pid
    if "robot_id" in payload:
        t.robot_id = payload.get("robot_id") or None
    if "type" in payload and payload.get("type"):
        val = payload.get("type")
        if isinstance(val, TriggerType):
            t.type = val
        else:
            t.type = TriggerType(str(val).upper())
    # Type-specific
    if t.type == TriggerType.TIME:
        t.cron_expression = payload.get("cron_expression") or None
        t.timezone = payload.get("timezone") or None
        t.queue_id = None
        t.batch_size = None
        t.polling_interval = None
        t.last_processed_item_id = None
        if not t.cron_expression:
            raise HTTPException(status_code=400, detail="cron_expression is required for TIME triggers")
    if t.type == TriggerType.QUEUE:
        qid = payload.get("queue_id") or t.queue_id
        if not qid:
            raise HTTPException(status_code=400, detail="queue_id is required for QUEUE triggers")
        q = session.exec(select(Queue).where(Queue.id == qid)).first()
        if not q:
            raise HTTPException(status_code=404, detail="Queue not found")
        t.queue_id = qid
        t.batch_size = payload.get("batch_size") or t.batch_size
        t.polling_interval = payload.get("polling_interval") or t.polling_interval
        # clear time-specific fields
        t.cron_expression = None
        t.timezone = payload.get("timezone") or t.timezone
    t.updated_at = now_iso()
    return t


@router.post("/", status_code=201, dependencies=[Depends(get_current_user), Depends(require_permission("triggers", "create"))])
def create_trigger(payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    trigger_type = _validate_payload(payload, session)
    t = Trigger(
        id=str(uuid.uuid4()),
        name=str(payload.get("name") or "").strip() or "(unnamed)",
        type=trigger_type,
        process_id=payload.get("process_id"),
        enabled=bool(payload.get("enabled", True)),
        robot_id=payload.get("robot_id") or None,
        cron_expression=payload.get("cron_expression") or None,
        timezone=payload.get("timezone") or None,
        last_fired_at=None,
        next_fire_at=None,
        queue_id=payload.get("queue_id") or None,
        batch_size=payload.get("batch_size"),
        polling_interval=payload.get("polling_interval"),
        last_processed_item_id=None,
        created_at=now_iso(),
        updated_at=now_iso(),
    )
    _apply_updates(t, {**payload, "type": trigger_type}, session)
    session.add(t)
    session.commit()
    session.refresh(t)
    try:
        log_event(session, action="trigger.create", entity_type="trigger", entity_id=t.id, entity_name=t.name, before=None, after=to_out(t), metadata=None, request=request, user=user)
    except Exception:
        pass
    return to_out(t)


@router.get("/", dependencies=[Depends(get_current_user), Depends(require_permission("triggers", "view"))])
def list_triggers(session=Depends(get_session)):
    ts: List[Trigger] = session.exec(select(Trigger)).all()
    ts.sort(key=lambda x: (x.name or ""))
    return [to_out(t) for t in ts]


@router.get("/{trigger_id}", dependencies=[Depends(get_current_user), Depends(require_permission("triggers", "view"))])
def get_trigger(trigger_id: str, session=Depends(get_session)):
    t = session.exec(select(Trigger).where(Trigger.id == trigger_id)).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trigger not found")
    return to_out(t)


@router.put("/{trigger_id}", dependencies=[Depends(get_current_user), Depends(require_permission("triggers", "edit"))])
def update_trigger(trigger_id: str, payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    t = session.exec(select(Trigger).where(Trigger.id == trigger_id)).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trigger not found")
    # Validate type/process/queue requirements against incoming state
    if "type" in payload or "process_id" in payload or "queue_id" in payload or "cron_expression" in payload:
        # Build a shadow dict to validate
        shadow = {
            "type": payload.get("type", t.type),
            "process_id": payload.get("process_id", t.process_id),
            "queue_id": payload.get("queue_id", t.queue_id),
            "cron_expression": payload.get("cron_expression", t.cron_expression),
        }
        _validate_payload(shadow, session)
    before = to_out(t)
    _apply_updates(t, payload, session)
    session.add(t)
    session.commit()
    session.refresh(t)
    after = to_out(t)
    try:
        log_event(session, action="trigger.update", entity_type="trigger", entity_id=t.id, entity_name=t.name, before=before, after=after, metadata=None, request=request, user=user)
    except Exception:
        pass
    return after


@router.delete("/{trigger_id}", status_code=204, dependencies=[Depends(get_current_user), Depends(require_permission("triggers", "delete"))])
def delete_trigger(trigger_id: str, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    t = session.exec(select(Trigger).where(Trigger.id == trigger_id)).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trigger not found")
    before = to_out(t)
    session.delete(t)
    session.commit()
    try:
        log_event(session, action="trigger.delete", entity_type="trigger", entity_id=trigger_id, entity_name=before.get("name"), before=before, after=None, metadata=None, request=request, user=user)
    except Exception:
        pass
    return None


@router.post("/{trigger_id}/enable", dependencies=[Depends(get_current_user), Depends(require_permission("triggers", "edit"))])
def enable_trigger(trigger_id: str, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    t = session.exec(select(Trigger).where(Trigger.id == trigger_id)).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trigger not found")
    t.enabled = True
    t.updated_at = now_iso()
    session.add(t)
    session.commit()
    session.refresh(t)
    try:
        log_event(session, action="trigger.enable", entity_type="trigger", entity_id=t.id, entity_name=t.name, before=None, after=to_out(t), metadata=None, request=request, user=user)
    except Exception:
        pass
    return to_out(t)


@router.post("/{trigger_id}/disable", dependencies=[Depends(get_current_user), Depends(require_permission("triggers", "edit"))])
def disable_trigger(trigger_id: str, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    t = session.exec(select(Trigger).where(Trigger.id == trigger_id)).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trigger not found")
    t.enabled = False
    t.updated_at = now_iso()
    session.add(t)
    session.commit()
    session.refresh(t)
    try:
        log_event(session, action="trigger.disable", entity_type="trigger", entity_id=t.id, entity_name=t.name, before=None, after=to_out(t), metadata=None, request=request, user=user)
    except Exception:
        pass
    return to_out(t)
