from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlmodel import Session, select
from .db import get_session
from .auth import get_current_user
from .models import QueueItem, Queue
from datetime import datetime
import json
from .audit_utils import log_event
from .permissions import require_permission

router = APIRouter(prefix="/queue-items", tags=["queue-items"])


def utcnow_iso() -> str:
    return datetime.utcnow().isoformat()


@router.get("/", response_model=List[QueueItem], dependencies=[Depends(require_permission("queue_items", "view"))])
def list_items(
    session: Session = Depends(get_session),
    user=Depends(get_current_user),
    queue_id: Optional[int] = Query(default=None),
    status: Optional[str] = Query(default=None),
):
    q = select(QueueItem)
    if queue_id is not None:
        q = q.where(QueueItem.queue_id == queue_id)
    if status:
        q = q.where(QueueItem.status == status)
    items = session.exec(q).all()
    return items


@router.get("/{item_id}", response_model=QueueItem, dependencies=[Depends(require_permission("queue_items", "view"))])
def get_item(item_id: int, session: Session = Depends(get_session), user=Depends(get_current_user)):
    obj = session.get(QueueItem, item_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Queue item not found")
    return obj


@router.post("/", response_model=QueueItem, status_code=201, dependencies=[Depends(require_permission("queue_items", "create"))])
def create_item(payload: QueueItem, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    # require queue exists
    queue = session.get(Queue, payload.queue_id)
    if not queue:
        raise HTTPException(status_code=400, detail="Queue does not exist")
    now = utcnow_iso()
    obj = QueueItem(
        queue_id=payload.queue_id,
        reference=payload.reference,
        status="new",
        priority=payload.priority or 0,
        payload=json.dumps(payload.payload) if isinstance(payload.payload, (dict, list)) else payload.payload,
        result=json.dumps(payload.result) if isinstance(payload.result, (dict, list)) else None,
        error_message=None,
        retries=0,
        locked_by_robot_id=None,
        locked_at=None,
        job_id=None,
        created_at=now,
        updated_at=now,
    )
    session.add(obj)
    session.commit()
    session.refresh(obj)
    try:
        log_event(session, action="queue_item.create", entity_type="queue_item", entity_id=obj.id, entity_name=str(obj.reference or obj.id), before=None, after={"queue_id": obj.queue_id, "status": obj.status}, metadata=None, request=request, user=user)
    except Exception:
        pass
    return obj


@router.put("/{item_id}", response_model=QueueItem, dependencies=[Depends(require_permission("queue_items", "edit"))])
def update_item(item_id: int, payload: QueueItem, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    obj = session.get(QueueItem, item_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Queue item not found")
    before_status = obj.status
    if payload.status is not None:
        obj.status = payload.status
    if payload.result is not None:
        obj.result = json.dumps(payload.result) if isinstance(payload.result, (dict, list)) else payload.result
    if payload.error_message is not None:
        obj.error_message = payload.error_message
    obj.updated_at = utcnow_iso()
    session.add(obj)
    session.commit()
    session.refresh(obj)
    try:
        if before_status != obj.status:
            log_event(session, action="queue_item.status_change", entity_type="queue_item", entity_id=obj.id, entity_name=str(obj.reference or obj.id), before={"status": before_status}, after={"status": obj.status}, metadata={"status_from": before_status, "status_to": obj.status}, request=request, user=user)
        else:
            log_event(session, action="queue_item.update", entity_type="queue_item", entity_id=obj.id, entity_name=str(obj.reference or obj.id), before=None, after={"status": obj.status}, metadata=None, request=request, user=user)
    except Exception:
        pass
    return obj


@router.delete("/{item_id}", status_code=204, dependencies=[Depends(require_permission("queue_items", "delete"))])
def delete_item(item_id: int, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    obj = session.get(QueueItem, item_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Queue item not found")
    before_ref = str(obj.reference or obj.id)
    session.delete(obj)
    session.commit()
    try:
        log_event(session, action="queue_item.delete", entity_type="queue_item", entity_id=item_id, entity_name=before_ref, before=None, after=None, metadata=None, request=request, user=user)
    except Exception:
        pass
    return None
