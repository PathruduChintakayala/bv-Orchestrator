from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel, validator
from sqlmodel import Session, select

from backend.audit_utils import log_event
from backend.auth import ALGORITHM, SECRET_KEY
from backend.db import get_session
from backend.models import User
from backend.permissions import has_permission
from backend.services.asset_service import AssetService

router = APIRouter(prefix="/runtime/secrets", tags=["runtime-secrets"])
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


class SecretResolveRequest(BaseModel):
    name: str

    @validator("name")
    def _name_required(cls, v: str) -> str:
        name = (v or "").strip()
        if not name:
            raise ValueError("name is required")
        return name


class SecretResolveResponse(BaseModel):
    value: str


@router.post("/resolve", response_model=SecretResolveResponse)
def resolve_secret(
    req: SecretResolveRequest,
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(get_sdk_user),
) -> SecretResolveResponse:
    service = AssetService(session)

    raw_name = req.name.strip()
    is_credential_password = False
    target_name = raw_name
    password_field = None

    if raw_name.lower().endswith(".password"):
        base = raw_name[:-9].strip()
        if not base:
            raise HTTPException(status_code=400, detail="Invalid credential password reference")
        is_credential_password = True
        target_name = base
        password_field = "password"

    asset = service.get_asset_by_name(target_name)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    typ = service._normalize_asset_type(asset.type)

    if is_credential_password:
        if typ != "credential":
            raise HTTPException(status_code=404, detail="Credential asset not found")
        _require_permission(session, user, "assets.read.credential.password", "assets.read.credential.password permission required")
        try:
            decrypted: Any = service.get_decrypted_value(asset)
            password = (decrypted or {}).get(password_field, "")
        except Exception:
            raise HTTPException(status_code=500, detail="Failed to resolve credential password")

        log_event(
            session,
            action="asset.credential.password.resolve",
            entity_type="asset",
            entity_id=asset.id,
            entity_name=asset.name,
            before=None,
            after=None,
            metadata={"runtime": True, "auth_type": "sdk", "field": password_field},
            request=request,
            user=user,
        )

        return SecretResolveResponse(value=str(password or ""))

    if typ != "secret":
        raise HTTPException(status_code=404, detail="Secret asset not found")

    _require_permission(session, user, "assets.read.secret", "assets.read.secret permission required")

    try:
        value = service.get_decrypted_value(asset)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decrypt secret")

    log_event(
        session,
        action="asset.secret.resolve",
        entity_type="asset",
        entity_id=asset.id,
        entity_name=asset.name,
        before=None,
        after=None,
        metadata={"runtime": True, "auth_type": "sdk"},
        request=request,
        user=user,
    )

    return SecretResolveResponse(value=value)
