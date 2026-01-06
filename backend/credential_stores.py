from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select
from backend.db import get_session
from backend.auth import get_current_user
from backend.permissions import require_permission
from backend.services.credential_store_service import CredentialStoreService
from backend.models import CredentialStore

router = APIRouter(prefix="/credential-stores", tags=["credential-stores"])


def _service(session=Depends(get_session)) -> CredentialStoreService:
    return CredentialStoreService(session)


def _get_store_by_external_id(session: Session, external_id: str) -> CredentialStore:
    """Resolve credential store by external_id (public GUID). Numeric IDs are rejected."""
    try:
        int(external_id)
        raise HTTPException(status_code=400, detail="Credential store identifiers must be external_id (GUID)")
    except ValueError:
        pass
    store = session.exec(select(CredentialStore).where(CredentialStore.external_id == external_id)).first()
    if not store:
        raise HTTPException(status_code=404, detail="Credential store not found")
    return store


@router.get("/", dependencies=[Depends(get_current_user), Depends(require_permission("credential_stores", "view"))])
def list_stores(service: CredentialStoreService = Depends(_service)):
    return service.list_stores()


@router.get("/{store_external_id}", dependencies=[Depends(get_current_user), Depends(require_permission("credential_stores", "view"))])
def get_store(store_external_id: str, service: CredentialStoreService = Depends(_service), session: Session = Depends(get_session)):
    store = _get_store_by_external_id(session, store_external_id)
    return service._to_out(store)


@router.post("/", status_code=201, dependencies=[Depends(get_current_user), Depends(require_permission("credential_stores", "create"))])
def create_store(payload: dict, service: CredentialStoreService = Depends(_service)):
    try:
        return service.create_store(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{store_external_id}", dependencies=[Depends(get_current_user), Depends(require_permission("credential_stores", "edit"))])
def update_store(store_external_id: str, payload: dict, service: CredentialStoreService = Depends(_service), session: Session = Depends(get_session)):
    store = _get_store_by_external_id(session, store_external_id)
    try:
        return service.update_store(store.id, payload)
    except ValueError as e:
        status = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=status, detail=str(e))
