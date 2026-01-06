from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlmodel import Session, select

import json

from backend.audit_utils import log_event
from backend.auth import ALGORITHM, SECRET_KEY
from backend.db import get_session
from backend.models import User
from backend.permissions import has_permission
from backend.services.asset_service import AssetService

router = APIRouter(prefix="/runtime/credentials", tags=["runtime-credentials"])
bearer_scheme = HTTPBearer()


def get_sdk_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    session: Session = Depends(get_session),
) -> User:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    if payload.get("auth_type") != "sdk":
        raise HTTPException(status_code=403, detail="SDK token required")

    username = payload.get("sub") or ""
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = session.exec(select(User).where(User.username == username)).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user


def _require_permission(session: Session, user: User, artifact: str, detail: str) -> None:
    if has_permission(session, user, artifact, "view"):
        return
    raise HTTPException(status_code=403, detail=detail)


class CredentialMetadataResponse(BaseModel):
    username: str


@router.get("/{name}", response_model=CredentialMetadataResponse)
def get_credential_metadata(
    name: str,
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(get_sdk_user),
) -> CredentialMetadataResponse:
    service = AssetService(session)
    asset = service.get_asset_by_name(name)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    typ = service._normalize_asset_type(asset.type)
    if typ != "credential":
        raise HTTPException(status_code=404, detail="Credential asset not found")

    _require_permission(session, user, "assets.read.credential.username", "assets.read.credential.username permission required")

    username_out = ""
    try:
        obj = json.loads(asset.value or "{}")
        username_out = obj.get("username", "")
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to read credential")

    log_event(
        session,
        action="asset.credential.metadata",
        entity_type="asset",
        entity_id=asset.id,
        entity_name=asset.name,
        before=None,
        after=None,
        metadata={"runtime": True, "auth_type": "sdk", "fields": ["username"]},
        request=request,
        user=user,
    )

    return CredentialMetadataResponse(username=str(username_out or ""))
