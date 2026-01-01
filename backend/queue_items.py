from typing import List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlmodel import Session, select
from backend.db import get_session
from backend.auth import get_current_user
from backend.models import QueueItem, Queue
from datetime import datetime
import json
from backend.audit_utils import log_event
from backend.permissions import require_permission
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError

router = APIRouter(prefix="/queue-items", tags=["queue-items"])


class CreateQueueItemRequest(BaseModel):
    queue_id: int
    reference: Optional[str] = None
    priority: int = 0
    payload: Optional[Any] = None


class UpdateQueueItemRequest(BaseModel):
    status: Optional[str] = None
    result: Optional[Any] = None
    error_message: Optional[str] = None


def utcnow_iso() -> str:
    return datetime.utcnow().isoformat()


@router.get("/", response_model=List[QueueItem], dependencies=[Depends(require_permission("queue_items", "view"))])
def list_items(
    session: Session = Depends(get_session),
    user=Depends(get_current_user),
    queue_id: Optional[int] = Query(default=None),
    status: Optional[str] = Query(default=None),
):
    if queue_id is None:
        raise HTTPException(status_code=400, detail="queue_id parameter is required")
    q = select(QueueItem).where(QueueItem.queue_id == queue_id)
    if status:
        q = q.where(QueueItem.status == status)
    items = session.exec(q).all()
    return items


@router.get("/{item_id}", response_model=QueueItem, dependencies=[Depends(require_permission("queue_items", "view"))])
def get_item(item_id: str, session: Session = Depends(get_session), user=Depends(get_current_user)):
    obj = session.get(QueueItem, item_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Queue item not found")
    return obj


@router.post("/", response_model=QueueItem, status_code=201, dependencies=[Depends(require_permission("queue_items", "create"))])
def create_item(payload: CreateQueueItemRequest, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    # require queue exists
    queue = session.get(Queue, payload.queue_id)
    if not queue:
        raise HTTPException(status_code=400, detail="Queue does not exist")
    
    # enforce unique reference if enabled for this queue
    if queue.enforce_unique_reference and payload.reference:
        existing = session.exec(select(QueueItem).where(QueueItem.queue_id == payload.queue_id, QueueItem.reference == payload.reference)).first()
        if existing:
            raise HTTPException(status_code=409, detail="Reference already exists in this queue.")
    
    now = utcnow_iso()
    obj = QueueItem(
        queue_id=payload.queue_id,
        reference=payload.reference,
        status="NEW",
        priority=payload.priority,
        payload=json.dumps(payload.payload) if isinstance(payload.payload, (dict, list)) else payload.payload,
        result=None,
        error_message=None,
        retries=0,
        locked_by_robot_id=None,
        locked_at=None,
        job_id=None,
        created_at=now,
        updated_at=now,
    )
    session.add(obj)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Reference already exists in this queue.")
    session.refresh(obj)
    try:
        log_event(session, action="queue_item.create", entity_type="queue_item", entity_id=obj.id, entity_name=str(obj.reference or obj.id), before=None, after={"queue_id": obj.queue_id, "status": obj.status}, metadata=None, request=request, user=user)
    except Exception:
        pass
    return obj


@router.put("/{item_id}", response_model=QueueItem, dependencies=[Depends(require_permission("queue_items", "edit"))])
def update_item(item_id: str, payload: UpdateQueueItemRequest, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
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
def delete_item(item_id: str, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    obj = session.get(QueueItem, item_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Queue item not found")
    if obj.status == "DELETED":
        raise HTTPException(status_code=400, detail="Item is already deleted")
    before_status = obj.status
    obj.status = "DELETED"
    obj.updated_at = utcnow_iso()
    session.add(obj)
    session.commit()
    try:
        log_event(session, action="queue_item.delete", entity_type="queue_item", entity_id=obj.id, entity_name=str(obj.reference or obj.id), before={"status": before_status}, after={"status": "DELETED"}, metadata={"status_from": before_status, "status_to": "DELETED"}, request=request, user=user)
    except Exception:
        pass
    return None
