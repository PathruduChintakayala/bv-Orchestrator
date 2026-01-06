from datetime import datetime, timedelta
from typing import List, Optional
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.auth import get_current_user
from backend.audit_utils import log_event, diff_dicts
from backend.db import get_session
from backend.models import Queue, QueueItem
from backend.permissions import require_permission

logger = logging.getLogger(__name__)

class CreateQueueRequest(BaseModel):
    name: str
    description: Optional[str] = None
    max_retries: Optional[int] = 0
    enforce_unique_reference: Optional[bool] = False

class UpdateQueueRequest(BaseModel):
    description: Optional[str] = None
    max_retries: Optional[int] = None

router = APIRouter(prefix="/queues", tags=["queues"])


def utcnow_iso() -> str:
    return datetime.utcnow().isoformat()


def _parse_iso(ts: Optional[str]) -> Optional[datetime]:
    """Parse ISO timestamp safely; return None when invalid."""
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except Exception:
        logger.debug("Unable to parse timestamp: %s", ts, exc_info=True)
        return None


def _derive_failure_reason(result: Optional[str], error_message: Optional[str]) -> str:
    """Extract a failure reason hint from result/error payloads."""
    reason = None
    if result:
        try:
            parsed = json.loads(result)
            reason = (
                parsed.get("failure_reason")
                or parsed.get("failureReason")
                or parsed.get("reason")
                or parsed.get("type")
            )
        except Exception:
            logger.debug("Failed to parse queue item result for reason: %s", result, exc_info=True)
    if not reason and error_message:
        em = error_message.lower()
        if "business" in em:
            reason = "BUSINESS"
    if not reason:
        reason = "APPLICATION"
    return str(reason).upper()


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


def _get_queue_by_external_id(session: Session, external_id: str) -> Queue:
    """Resolve queue by external_id (public GUID). Numeric IDs are rejected to enforce the GUID surface."""
    # Reject pure integers to avoid accidental numeric ID usage
    try:
        int(external_id)
        raise HTTPException(status_code=400, detail="Queue identifiers must be external_id (GUID)")
    except ValueError:
        pass

    obj = session.exec(select(Queue).where(Queue.external_id == external_id)).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Queue not found")
    return obj


def _queue_to_out(q: Queue) -> dict:
    return {
        "id": q.external_id,
        "_internal_id": q.id,  # deprecated: prefer id (external_id)
        "name": q.name,
        "description": q.description,
        "max_retries": q.max_retries,
        "enforce_unique_reference": q.enforce_unique_reference,
        "is_active": q.is_active,
        "created_at": q.created_at,
        "updated_at": q.updated_at,
    }


@router.get("/{queue_external_id}", dependencies=[Depends(require_permission("queues", "view"))])
def get_queue(queue_external_id: str, session: Session = Depends(get_session), user=Depends(get_current_user)):
    obj = _get_queue_by_external_id(session, queue_external_id)
    return _queue_to_out(obj)


@router.get("/{queue_external_id}/stats", dependencies=[Depends(require_permission("queues", "view"))])
def get_queue_stats(queue_external_id: str, session: Session = Depends(get_session), user=Depends(get_current_user)):
    queue = _get_queue_by_external_id(session, queue_external_id)
    
    # Fetch only the fields we need to compute statistics without stale caches.
    rows = session.exec(
        select(
            QueueItem.status,
            QueueItem.output,
            QueueItem.error_reason,
            QueueItem.locked_at,
            QueueItem.created_at,
            QueueItem.updated_at,
            QueueItem.retries,
            QueueItem.error_type,
        ).where(QueueItem.queue_id == queue.id, QueueItem.status != "DELETED")
    ).all()

    in_progress = 0
    new_count = 0
    abandoned = 0
    successful = 0
    app_exceptions = 0
    biz_exceptions = 0
    durations: List[float] = []

    visibility_timeout = timedelta(seconds=300)
    now = datetime.utcnow()
    max_retries = getattr(queue, "max_retries", 0) or 0

    for row in rows:
        status = (row.status or "").upper()
        locked_at_dt = _parse_iso(row.locked_at)
        updated_at_dt = _parse_iso(row.updated_at)

        if status == "ABANDONED":
            abandoned += 1
        elif status == "IN_PROGRESS":
            # Count as in-progress only when the lease is still valid; expired leases are effectively available again.
            if locked_at_dt and (now - locked_at_dt) < visibility_timeout:
                in_progress += 1
            else:
                new_count += 1
        elif status == "NEW":
            new_count += 1
        elif status == "DONE":
            successful += 1
        elif status == "FAILED":
            # Only count terminal failures (retries exhausted). Transient failures requeued to NEW are excluded.
            if row.retries is not None and row.retries >= max_retries:
                # Prefer explicit error_type when set; otherwise derive from payload/reason.
                if row.error_type:
                    if str(row.error_type).upper() == "BUSINESS":
                        biz_exceptions += 1
                    else:
                        app_exceptions += 1
                else:
                    derived_reason = _derive_failure_reason(
                        json.dumps(row.output) if isinstance(row.output, (dict, list)) else row.output,
                        row.error_reason,
                    )
                    if derived_reason == "BUSINESS":
                        biz_exceptions += 1
                    else:
                        app_exceptions += 1
        elif status == "ABANDONED":
            # Treat abandoned as terminal application-type failures for counting.
            app_exceptions += 1

        # Processing time: only for terminal DONE or terminal FAILED
        if status == "DONE" and locked_at_dt and updated_at_dt:
            durations.append(max((updated_at_dt - locked_at_dt).total_seconds(), 0))
        elif status == "FAILED" and locked_at_dt and updated_at_dt:
            if row.retries is not None and row.retries >= max_retries:
                durations.append(max((updated_at_dt - locked_at_dt).total_seconds(), 0))
        elif status == "ABANDONED" and locked_at_dt and updated_at_dt:
            durations.append(max((updated_at_dt - locked_at_dt).total_seconds(), 0))

    avg_processing_time = sum(durations) / len(durations) if durations else 0
    remaining = new_count + in_progress

    stats = {
        'inProgress': in_progress,
        'remaining': remaining,
        'avgProcessingTime': avg_processing_time,
        'successful': successful,
        'appExceptions': app_exceptions,
        'bizExceptions': biz_exceptions,
        'abandoned': abandoned,
    }

    try:
            logger.debug("Computed queue stats", extra={"queue_id": queue.id, "queue_external_id": queue.external_id, "stats": stats, "total_items": len(rows)})
    except Exception:
        pass

    return stats


@router.post("/", status_code=201, dependencies=[Depends(require_permission("queues", "create"))])
def create_queue(payload: CreateQueueRequest, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    # enforce unique name
    existing = session.exec(select(Queue).where(Queue.name == payload.name)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Queue name already exists")
    now = utcnow_iso()
    obj = Queue(
        name=payload.name,
        description=payload.description,
        max_retries=payload.max_retries or 0,
        enforce_unique_reference=payload.enforce_unique_reference or False,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    session.add(obj)
    try:
        session.commit()
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=400, detail="Failed to create queue")
    session.refresh(obj)
    try:
        log_event(session, action="queue.create", entity_type="queue", entity_id=obj.id, entity_name=obj.name, before=None, after={"name": obj.name}, metadata=None, request=request, user=user)
    except Exception:
        pass
    return _queue_to_out(obj)


@router.put("/{queue_external_id}", dependencies=[Depends(require_permission("queues", "edit"))])
def update_queue(queue_external_id: str, payload: UpdateQueueRequest, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    obj = _get_queue_by_external_id(session, queue_external_id)
    before = {"name": obj.name, "description": obj.description, "max_retries": obj.max_retries, "enforce_unique_reference": obj.enforce_unique_reference}
    if payload.description is not None:
        obj.description = payload.description
    if payload.max_retries is not None:
        obj.max_retries = payload.max_retries
    # enforce_unique_reference is immutable
    obj.updated_at = utcnow_iso()
    session.add(obj)
    session.commit()
    session.refresh(obj)
    after = {"name": obj.name, "description": obj.description, "max_retries": obj.max_retries, "enforce_unique_reference": obj.enforce_unique_reference}
    try:
        changes = diff_dicts(before, after)
        log_event(session, action="queue.update", entity_type="queue", entity_id=obj.id, entity_name=obj.name, before=before, after=after, metadata={"changed_keys": list(changes.keys()), "diff": changes}, request=request, user=user)
    except Exception:
        pass
    return _queue_to_out(obj)


@router.delete("/{queue_external_id}", status_code=204, dependencies=[Depends(require_permission("queues", "delete"))])
def delete_queue(queue_external_id: str, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    obj = _get_queue_by_external_id(session, queue_external_id)
    before = {"name": obj.name, "description": obj.description, "max_retries": obj.max_retries}
    
    # Delete all queue items associated with this queue (hard delete)
    queue_items = session.exec(select(QueueItem).where(QueueItem.queue_id == obj.id)).all()
    for item in queue_items:
        session.delete(item)
    
    # Delete the queue itself
    session.delete(obj)
    session.commit()
    try:
        log_event(session, action="queue.delete", entity_type="queue", entity_id=queue_id, entity_name=before.get("name"), before=before, after=None, metadata={"deleted_queue_items_count": len(queue_items)}, request=request, user=user)
    except Exception:
        pass
    return None
