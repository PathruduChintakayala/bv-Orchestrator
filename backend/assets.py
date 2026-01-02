from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from backend.db import get_session
from backend.auth import get_current_user
from backend.permissions import require_permission
from backend.services.asset_service import AssetService

router = APIRouter(prefix="/assets", tags=["assets"])

@router.get("/", dependencies=[Depends(get_current_user), Depends(require_permission("assets", "view"))])
def list_assets(search: Optional[str] = None, session=Depends(get_session)):
    service = AssetService(session)
    return service.list_assets(search)

@router.get("/{asset_id}", dependencies=[Depends(get_current_user), Depends(require_permission("assets", "view"))])
def get_asset(asset_id: int, session=Depends(get_session)):
    service = AssetService(session)
    asset = service.get_asset(asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset

@router.post("/", status_code=201, dependencies=[Depends(get_current_user), Depends(require_permission("assets", "create"))])
def create_asset(payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    service = AssetService(session)
    try:
        return service.create_asset(payload, user, request)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/{asset_id}", dependencies=[Depends(get_current_user), Depends(require_permission("assets", "edit"))])
def update_asset(asset_id: int, payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    service = AssetService(session)
    try:
        return service.update_asset(asset_id, payload, user, request)
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{asset_id}", status_code=204, dependencies=[Depends(get_current_user), Depends(require_permission("assets", "delete"))])
def delete_asset(asset_id: int, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    service = AssetService(session)
    try:
        service.delete_asset(asset_id, user, request)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return None
