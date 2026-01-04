from typing import Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Request, Header
from backend.db import get_session
from backend.auth import get_current_user
from backend.permissions import require_permission, has_permission
from backend.services.asset_service import AssetService
from backend.robot_dependencies import get_current_robot

router = APIRouter(prefix="/assets", tags=["assets"])

def get_runtime_auth(
    request: Request,
    session = Depends(get_session),
    x_robot_token: Optional[str] = Header(None, alias="X-Robot-Token")
) -> Any:
    """Check for either a valid user session or a robot token."""
    # 1. Try Robot Token
    if x_robot_token:
        from backend.models import Robot
        from sqlmodel import select
        robot = session.exec(select(Robot).where(Robot.api_token == x_robot_token)).first()
        if robot:
            return robot

    # 2. Try User Token (Standard Auth)
    auth_header = request.headers.get("Authorization")
    if auth_header:
        try:
            # We don't use Depends(get_current_user) here to avoid mandatory 401 if it fails
            from backend.auth import SECRET_KEY, ALGORITHM
            from jose import jwt
            from backend.models import User
            from sqlmodel import select
            
            if not auth_header.startswith("Bearer "):
                raise HTTPException(status_code=401, detail="Authorization header must start with 'Bearer '")
            
            token = auth_header.split(" ", 1)[1].strip()
            if not token:
                raise HTTPException(status_code=401, detail="Token is missing")
            
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            username = payload.get("sub")
            if not username:
                raise HTTPException(status_code=401, detail="Token missing 'sub' claim")
            
            user = session.exec(select(User).where(User.username == username)).first()
            if not user:
                raise HTTPException(status_code=401, detail=f"User '{username}' not found")
            
            # Check appropriate permission based on HTTP method
            method = request.method.upper()
            if method in ("PUT", "POST", "DELETE"):
                # For write operations, check edit permission
                if has_permission(session, user, "assets", "edit"):
                    return user
                raise HTTPException(status_code=403, detail="Insufficient permissions: 'assets:edit' required")
            else:
                # For read operations, check view permission
                if has_permission(session, user, "assets", "view"):
                    return user
                raise HTTPException(status_code=403, detail="Insufficient permissions: 'assets:view' required")
        except HTTPException:
            raise
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token has expired")
        except jwt.JWTError as e:
            raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
        except Exception as e:
            # Log the actual error for debugging
            import logging
            logging.error(f"Error in get_runtime_auth for assets: {type(e).__name__}: {str(e)}")
            raise HTTPException(status_code=401, detail=f"Authentication failed: {str(e)}")

    raise HTTPException(status_code=401, detail="Valid user or robot token required")

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

@router.get("/name/{name}")
def get_asset_by_name(name: str, session=Depends(get_session), auth=Depends(get_runtime_auth)):
    service = AssetService(session)
    asset = service.get_asset_by_name(name)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return service.asset_to_out(asset)

@router.get("/secret/{name}")
def get_secret_runtime(name: str, session=Depends(get_session), auth=Depends(get_runtime_auth)):
    service = AssetService(session)
    asset = service.get_asset_by_name(name)
    if not asset or service._normalize_asset_type(asset.type) != "secret":
        raise HTTPException(status_code=404, detail="Secret asset not found")
    return {"value": asset.value}

@router.get("/credential/{name}")
def get_credential_runtime(name: str, session=Depends(get_session), auth=Depends(get_runtime_auth)):
    service = AssetService(session)
    asset = service.get_asset_by_name(name)
    if not asset or service._normalize_asset_type(asset.type) != "credential":
        raise HTTPException(status_code=404, detail="Credential asset not found")
    return service.get_credential_value(asset)

@router.put("/name/{name}")
def set_asset_by_name(name: str, payload: dict, request: Request, session=Depends(get_session), auth=Depends(get_runtime_auth)):
    service = AssetService(session)
    try:
        return service.update_asset_by_name(name, payload, auth, request, is_raw=False)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/secret/{name}")
def set_secret_runtime(name: str, payload: dict, request: Request, session=Depends(get_session), auth=Depends(get_runtime_auth)):
    service = AssetService(session)
    try:
        # payload expected to have {"value": "..."} which is already encrypted
        return service.update_asset_by_name(name, payload, auth, request, is_raw=True)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/credential/{name}")
def set_credential_runtime(name: str, payload: dict, request: Request, session=Depends(get_session), auth=Depends(get_runtime_auth)):
    service = AssetService(session)
    try:
        # payload expected to have {"username": "...", "password": "..."} which is already encrypted
        return service.update_asset_by_name(name, payload, auth, request, is_raw=True)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
