from typing import List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Header, BackgroundTasks
from sqlmodel import Session, select
from backend.db import get_session
from backend.auth import get_current_user
from backend.models import QueueItem, Queue
from datetime import datetime
import json
from backend.audit_utils import log_event
from backend.permissions import require_permission, has_permission
from backend.timezone_utils import get_display_timezone, to_display_iso
from backend.notification_service import NotificationService
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel

router = APIRouter(prefix="/queue-items", tags=["queue-items"])


def get_runtime_auth(
    request: Request,
    session = Depends(get_session),
    x_robot_token: Optional[str] = Header(None, alias="X-Robot-Token")
) -> Any:
    """Check for either a valid user session or a robot token (reused from assets)."""
    # 1. Try Robot Token
    if x_robot_token:
        from backend.models import Robot
        robot = session.exec(select(Robot).where(Robot.api_token == x_robot_token)).first()
        if robot:
            return robot

    # 2. Try User Token (Standard Auth)
    auth_header = request.headers.get("Authorization")
    if auth_header:
        try:
            from backend.auth import SECRET_KEY, ALGORITHM
            from jose import jwt
            from backend.models import User
            
            token = auth_header.split(" ")[1]
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            username = payload.get("sub")
            if username:
                user = session.exec(select(User).where(User.username == username)).first()
                if user:
                    # Check appropriate permission based on HTTP method
                    method = request.method.upper()
                    path = request.url.path
                    if method == "POST":
                        # For create operations, check create permission
                        if has_permission(session, user, "queue_items", "create"):
                            return user
                        raise HTTPException(status_code=403, detail="Insufficient permissions: 'queue_items:create' required")
                    elif method in ("PUT", "DELETE"):
                        # For update/delete operations, check edit permission
                        if has_permission(session, user, "queue_items", "edit"):
                            return user
                        raise HTTPException(status_code=403, detail="Insufficient permissions: 'queue_items:edit' required")
                    else:
                        # For read operations, check view permission
                        if has_permission(session, user, "queue_items", "view"):
                            return user
                        raise HTTPException(status_code=403, detail="Insufficient permissions: 'queue_items:view' required")
        except HTTPException:
            raise
        except Exception:
            pass

    raise HTTPException(status_code=401, detail="Valid user or robot token required")


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


def _queue_item_to_out(item: QueueItem, tz: str) -> dict:
    return {
        "id": item.id,
        "queue_id": item.queue_id,
        "reference": item.reference,
        "status": item.status,
        "priority": item.priority,
        "payload": item.payload,
        "result": item.result,
        "error_message": item.error_message,
        "retries": item.retries,
        "locked_by_robot_id": item.locked_by_robot_id,
        "locked_at": to_display_iso(item.locked_at, tz),
        "job_id": item.job_id,
        "created_at": to_display_iso(item.created_at, tz),
        "updated_at": to_display_iso(item.updated_at, tz),
    }


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
    tz = get_display_timezone(session)
    return [_queue_item_to_out(it, tz) for it in items]


# IMPORTANT: /next must be defined BEFORE /{item_id} to avoid routing conflict
@router.get("/next")
def get_next_item(
    queue_name: Optional[str] = Query(None),
    queue_id: Optional[int] = Query(None),
    session: Session = Depends(get_session),
    auth=Depends(get_runtime_auth)
):
    if not queue_name and queue_id is None:
        raise HTTPException(status_code=400, detail="queue_name or queue_id required")
    
    if queue_id is None:
        queue = session.exec(select(Queue).where(Queue.name == queue_name)).first()
        if not queue:
            raise HTTPException(status_code=404, detail="Queue not found")
        queue_id = queue.id

    # Atomic find and lock (simplistic implementation using status update)
    item = session.exec(
        select(QueueItem)
        .where(QueueItem.queue_id == queue_id, QueueItem.status == "NEW")
        .order_by(QueueItem.priority.desc(), QueueItem.created_at.asc())
    ).first()

    if not item:
        raise HTTPException(status_code=404, detail="No NEW items available in queue")

    item.status = "IN_PROGRESS"
    item.updated_at = utcnow_iso()
    session.add(item)
    session.commit()
    session.refresh(item)
    
    return {
        "id": item.id,
        "payload": json.loads(item.payload) if isinstance(item.payload, str) else item.payload,
        "reference": item.reference,
        "priority": item.priority
    }


@router.get("/{item_id}", response_model=QueueItem, dependencies=[Depends(require_permission("queue_items", "view"))])
def get_item(item_id: str, session: Session = Depends(get_session), user=Depends(get_current_user)):
    obj = session.get(QueueItem, item_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Queue item not found")
    tz = get_display_timezone(session)
    return _queue_item_to_out(obj, tz)


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
    tz = get_display_timezone(session)
    return _queue_item_to_out(obj, tz)


@router.put("/{item_id}", response_model=QueueItem, dependencies=[Depends(require_permission("queue_items", "edit"))])
def update_item(item_id: str, payload: UpdateQueueItemRequest, request: Request, background_tasks: BackgroundTasks, session: Session = Depends(get_session), user=Depends(get_current_user)):
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
    try:
        queue = session.get(Queue, obj.queue_id)
        if obj.status and obj.status.upper() == "FAILED" and queue and getattr(queue, "max_retries", 0) and getattr(obj, "retries", 0) >= getattr(queue, "max_retries", 0):
            NotificationService(session).notify_queue_item_failed(obj, queue, background_tasks)
    except Exception:
        pass
    tz = get_display_timezone(session)
    return _queue_item_to_out(obj, tz)


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


class RuntimeAddRequest(BaseModel):
    queue_name: str
    payload: dict
    reference: Optional[str] = None


@router.post("/add")
def add_item_runtime(
    req: RuntimeAddRequest,
    request: Request,
    session: Session = Depends(get_session),
    auth=Depends(get_runtime_auth)
):
    queue = session.exec(select(Queue).where(Queue.name == req.queue_name)).first()
    if not queue:
        raise HTTPException(status_code=404, detail="Queue not found")
    
    # Check reference uniqueness if enabled
    if queue.enforce_unique_reference and req.reference:
        existing = session.exec(select(QueueItem).where(QueueItem.queue_id == queue.id, QueueItem.reference == req.reference)).first()
        if existing:
            raise HTTPException(status_code=409, detail="Reference already exists")

    now = utcnow_iso()
    item = QueueItem(
        queue_id=queue.id,
        reference=req.reference,
        status="NEW",
        payload=json.dumps(req.payload),
        created_at=now,
        updated_at=now,
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    
    return {"id": item.id}


@router.put("/{item_id}/status")
def set_item_status_runtime(
    item_id: str,
    payload: UpdateQueueItemRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    auth=Depends(get_runtime_auth)
):
    item = session.get(QueueItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Queue item not found")
    
    before_status = item.status
    if payload.status:
        item.status = payload.status
    if payload.result is not None:
        item.result = json.dumps(payload.result) if isinstance(payload.result, (dict, list)) else str(payload.result)
    if payload.error_message is not None:
        item.error_message = payload.error_message
    
    item.updated_at = utcnow_iso()
    session.add(item)
    session.commit()
    session.refresh(item)

    try:
        actor_name = getattr(auth, "username", None) or getattr(auth, "name", "system")
        if before_status != item.status:
            log_event(session, action="queue_item.status_change", entity_type="queue_item", entity_id=item.id, entity_name=str(item.reference or item.id), before={"status": before_status}, after={"status": item.status}, metadata={"status_from": before_status, "status_to": item.status}, request=request, actor_username=actor_name)
    except Exception:
        pass

    try:
        queue = session.get(Queue, item.queue_id)
        if item.status and item.status.upper() == "FAILED" and queue and getattr(queue, "max_retries", 0) and getattr(item, "retries", 0) >= getattr(queue, "max_retries", 0):
            NotificationService(session).notify_queue_item_failed(item, queue, background_tasks)
    except Exception:
        pass

    return {"id": item.id, "status": item.status}
