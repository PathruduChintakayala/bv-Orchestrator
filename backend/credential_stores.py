from fastapi import APIRouter, Depends, HTTPException, Request
from backend.db import get_session
from backend.auth import get_current_user
from backend.permissions import require_permission
from backend.services.credential_store_service import CredentialStoreService

router = APIRouter(prefix="/credential-stores", tags=["credential-stores"])


def _service(session=Depends(get_session)) -> CredentialStoreService:
    return CredentialStoreService(session)


@router.get("/", dependencies=[Depends(get_current_user), Depends(require_permission("credential_stores", "view"))])
def list_stores(service: CredentialStoreService = Depends(_service)):
    return service.list_stores()


@router.post("/", status_code=201, dependencies=[Depends(get_current_user), Depends(require_permission("credential_stores", "create"))])
def create_store(payload: dict, service: CredentialStoreService = Depends(_service)):
    try:
        return service.create_store(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{store_id}", dependencies=[Depends(get_current_user), Depends(require_permission("credential_stores", "edit"))])
def update_store(store_id: int, payload: dict, service: CredentialStoreService = Depends(_service)):
    try:
        return service.update_store(store_id, payload)
    except ValueError as e:
        status = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=status, detail=str(e))
