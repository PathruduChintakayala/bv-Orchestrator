from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlmodel import Session, select
from .db import get_session
from .auth import get_current_user
from .models import Queue
from datetime import datetime
from .audit_utils import log_event, diff_dicts
from .permissions import require_permission

router = APIRouter(prefix="/queues", tags=["queues"])


def utcnow_iso() -> str:
    return datetime.utcnow().isoformat()


@router.get("/", response_model=List[Queue], dependencies=[Depends(require_permission("queues", "view"))])
def list_queues(
    session: Session = Depends(get_session),
    user=Depends(get_current_user),
    search: Optional[str] = Query(default=None),
    active_only: Optional[bool] = Query(default=None),
):
    q = select(Queue)
    if search:
        like = f"%{search}%"
        q = q.where((Queue.name.ilike(like)) | (Queue.description.ilike(like)))
    # Note: active_only parameter kept for backward compatibility but queues are always considered active
    res = session.exec(q).all()
    return res


@router.get("/{queue_id}", response_model=Queue, dependencies=[Depends(require_permission("queues", "view"))])
def get_queue(queue_id: int, session: Session = Depends(get_session), user=Depends(get_current_user)):
    obj = session.get(Queue, queue_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Queue not found")
    return obj


@router.post("/", response_model=Queue, status_code=201, dependencies=[Depends(require_permission("queues", "create"))])
def create_queue(payload: Queue, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    # enforce unique name
    existing = session.exec(select(Queue).where(Queue.name == payload.name)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Queue name already exists")
    now = utcnow_iso()
    obj = Queue(
        name=payload.name,
        description=payload.description,
        max_retries=payload.max_retries if payload.max_retries is not None else 0,
        created_at=now,
        updated_at=now,
    )
    session.add(obj)
    session.commit()
    session.refresh(obj)
    try:
        log_event(session, action="queue.create", entity_type="queue", entity_id=obj.id, entity_name=obj.name, before=None, after={"name": obj.name}, metadata=None, request=request, user=user)
    except Exception:
        pass
    return obj


@router.put("/{queue_id}", response_model=Queue, dependencies=[Depends(require_permission("queues", "edit"))])
def update_queue(queue_id: int, payload: Queue, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    obj = session.get(Queue, queue_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Queue not found")
    before = {"name": obj.name, "description": obj.description, "max_retries": obj.max_retries}
    if payload.description is not None:
        obj.description = payload.description
    if payload.max_retries is not None:
        obj.max_retries = payload.max_retries
    obj.updated_at = utcnow_iso()
    session.add(obj)
    session.commit()
    session.refresh(obj)
    after = {"name": obj.name, "description": obj.description, "max_retries": obj.max_retries}
    try:
        changes = diff_dicts(before, after)
        log_event(session, action="queue.update", entity_type="queue", entity_id=obj.id, entity_name=obj.name, before=before, after=after, metadata={"changed_keys": list(changes.keys()), "diff": changes}, request=request, user=user)
    except Exception:
        pass
    return obj


@router.delete("/{queue_id}", status_code=204, dependencies=[Depends(require_permission("queues", "delete"))])
def delete_queue(queue_id: int, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    obj = session.get(Queue, queue_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Queue not found")
    before = {"name": obj.name, "description": obj.description, "max_retries": obj.max_retries}
    session.delete(obj)
    session.commit()
    try:
        log_event(session, action="queue.delete", entity_type="queue", entity_id=queue_id, entity_name=before.get("name"), before=before, after=None, metadata=None, request=request, user=user)
    except Exception:
        pass
    return None
