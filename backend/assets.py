from datetime import datetime
from typing import Optional

import json
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import select
from passlib.context import CryptContext

from backend.db import get_session
from backend.auth import get_current_user
from backend.models import Asset
from backend.permissions import require_permission
from backend.audit_utils import log_event, diff_dicts

router = APIRouter(prefix="/assets", tags=["assets"]) 

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

CANONICAL_TYPES = {"text", "int", "bool", "secret", "credential"}


def normalize_asset_type(raw: str) -> str:
    v = (raw or "").strip()
    if not v:
        return "text"
    low = v.lower()
    if low in {"text"}:
        return "text"
    if low in {"int", "integer"}:
        return "int"
    if low in {"bool", "boolean"}:
        return "bool"
    if low in {"secret"}:
        return "secret"
    if low in {"credential", "credentials"}:
        return "credential"
    # legacy TitleCase values were already handled by lowercasing above
    raise HTTPException(status_code=400, detail="Invalid asset type")

def hash_secret(raw: str) -> str:
    return pwd_context.hash(raw)

class AssetBase:
    name: str
    type: str
    value: str
    is_secret: bool = False
    description: Optional[str] = None

# Using dict payloads to keep it simple with SQLModel

def now_iso():
    return datetime.now().isoformat(timespec='seconds')

@router.get("/", dependencies=[Depends(get_current_user), Depends(require_permission("assets", "view"))])
def list_assets(search: Optional[str] = None, session=Depends(get_session)):
    stmt = select(Asset)
    assets = session.exec(stmt).all()
    if search:
        s = search.lower()
        assets = [a for a in assets if s in a.name.lower() or (a.description and s in a.description.lower())]
    assets.sort(key=lambda a: a.name.lower())
    return [asset_to_out(a) for a in assets]

@router.get("/{asset_id}", dependencies=[Depends(get_current_user), Depends(require_permission("assets", "view"))])
def get_asset(asset_id: int, session=Depends(get_session)):
    a = session.exec(select(Asset).where(Asset.id == asset_id)).first()
    if not a:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset_to_out(a)

@router.post("/", status_code=201, dependencies=[Depends(get_current_user), Depends(require_permission("assets", "create"))])
def create_asset(payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if session.exec(select(Asset).where(Asset.name == name)).first():
        raise HTTPException(status_code=400, detail="An asset with this name already exists")
    asset_type = normalize_asset_type(payload.get("type") or "text")

    # Prepare storage according to type
    stored_value = ""
    is_secret = False

    if asset_type in {"text", "int", "bool"}:
        value = (payload.get("value") or "").strip()
        if not value:
            raise HTTPException(status_code=400, detail="Value is required")
        stored_value = value
        is_secret = False
    elif asset_type == "secret":
        value = (payload.get("value") or "").strip()
        if not value:
            raise HTTPException(status_code=400, detail="Value is required for secret")
        stored_value = hash_secret(value)
        is_secret = True
    elif asset_type == "credential":
        username = (payload.get("username") or "").strip()
        password = (payload.get("password") or "").strip()
        if not username or not password:
            raise HTTPException(status_code=400, detail="Username and password are required for credential")
        stored_value = json.dumps({
            "username": username,
            "password_hash": hash_secret(password)
        })
        is_secret = True

    a = Asset(
        name=name,
        type=asset_type,
        value=stored_value,
        is_secret=is_secret,
        description=payload.get("description") or None,
        created_at=now_iso(),
        updated_at=now_iso(),
    )
    session.add(a)
    session.commit()
    session.refresh(a)
    out = asset_to_out(a)
    try:
        log_event(
            session,
            action="asset.create",
            entity_type="asset",
            entity_id=a.id,
            entity_name=a.name,
            before=None,
            after=out,
            metadata=None,
            request=request,
            user=user,
        )
    except Exception:
        pass
    return out

@router.put("/{asset_id}", dependencies=[Depends(get_current_user), Depends(require_permission("assets", "edit"))])
def update_asset(asset_id: int, payload: dict, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    a = session.exec(select(Asset).where(Asset.id == asset_id)).first()
    if not a:
        raise HTTPException(status_code=404, detail="Asset not found")
    before_out = asset_to_out(a)
    if "name" in payload and payload["name"]:
        new_name = payload["name"].strip()
        if new_name != a.name:
            if session.exec(select(Asset).where(Asset.name == new_name)).first():
                raise HTTPException(status_code=400, detail="An asset with this name already exists")
            a.name = new_name
    if "type" in payload and payload["type"]:
        a.type = normalize_asset_type(str(payload["type"]))

    # Update value according to type
    cur_type = normalize_asset_type(a.type)
    if cur_type in {"text", "int", "bool"}:
        if "value" in payload and payload["value"] is not None:
            a.value = str(payload["value"]).strip()
        a.is_secret = False
    elif cur_type == "secret":
        # If new value provided, hash and replace; else keep existing hash
        if "value" in payload and payload["value"]:
            a.value = hash_secret(str(payload["value"]).strip())
        a.is_secret = True
    elif cur_type == "credential":
        # Allow updating username and/or password
        current = {}
        try:
            current = json.loads(a.value or "{}")
        except Exception:
            current = {}
        username = payload.get("username")
        password = payload.get("password")
        if username is not None:
            current["username"] = str(username).strip()
        if password:
            current["password_hash"] = hash_secret(str(password).strip())
        a.value = json.dumps({
            "username": current.get("username", ""),
            "password_hash": current.get("password_hash", "")
        })
        a.is_secret = True
    if "description" in payload:
        a.description = payload.get("description") or None
    a.updated_at = now_iso()
    session.add(a)
    session.commit()
    session.refresh(a)
    after_out = asset_to_out(a)
    try:
        changes = diff_dicts(before_out, after_out)
        log_event(
            session,
            action="asset.update",
            entity_type="asset",
            entity_id=a.id,
            entity_name=a.name,
            before=before_out,
            after=after_out,
            metadata={"changed_keys": list(changes.keys()), "diff": changes},
            request=request,
            user=user,
        )
    except Exception:
        pass
    return after_out

@router.delete("/{asset_id}", status_code=204, dependencies=[Depends(get_current_user), Depends(require_permission("assets", "delete"))])
def delete_asset(asset_id: int, request: Request, session=Depends(get_session), user=Depends(get_current_user)):
    a = session.exec(select(Asset).where(Asset.id == asset_id)).first()
    if not a:
        raise HTTPException(status_code=404, detail="Asset not found")
    before_out = asset_to_out(a)
    session.delete(a)
    session.commit()
    try:
        log_event(
            session,
            action="asset.delete",
            entity_type="asset",
            entity_id=asset_id,
            entity_name=before_out.get("name"),
            before=before_out,
            after=None,
            metadata=None,
            request=request,
            user=user,
        )
    except Exception:
        pass
    return None


def asset_to_out(a: Asset) -> dict:
    # Prepare safe output: mask secrets; expose username for credential; never expose password hash
    typ = normalize_asset_type(a.type)
    value_out: Optional[str] = a.value
    username_out: Optional[str] = None
    if typ == "secret":
        value_out = "***"
    elif typ == "credential":
        try:
            obj = json.loads(a.value or "{}")
            username_out = obj.get("username")
        except Exception:
            username_out = None
        value_out = "***"
    return {
        "id": a.id,
        "name": a.name,
        "type": typ,
        "value": value_out,
        "username": username_out,
        "is_secret": a.is_secret,
        "description": a.description,
        "created_at": a.created_at,
        "updated_at": a.updated_at,
    }
