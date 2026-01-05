import json
from datetime import datetime
from typing import Optional, List, Dict, Any
from sqlmodel import Session, select
from backend.models import Asset, CredentialStore
from backend.repositories.asset_repository import AssetRepository
from backend.encryption import encrypt_value, decrypt_value
from backend.audit_utils import log_event, diff_dicts

def now_iso():
    return datetime.now().isoformat(timespec='seconds')

class AssetService:
    CANONICAL_TYPES = {"text", "int", "bool", "secret", "credential"}

    def __init__(self, session: Session):
        self.session = session
        self.repo = AssetRepository(session)

    def _get_default_store_id(self) -> Optional[int]:
        store = self.session.exec(select(CredentialStore).where(CredentialStore.is_default == True)).first()
        return store.id if store else None

    def _resolve_store_id(self, store_id: Optional[int]) -> Optional[int]:
        if store_id is None:
            return self._get_default_store_id()
        store = self.session.get(CredentialStore, store_id)
        if not store:
            raise ValueError("Credential store not found")
        if not store.is_active and store.is_default:
            raise ValueError("Default credential store is inactive")
        return store.id

    def list_assets(self, search: Optional[str] = None) -> List[Dict[str, Any]]:
        assets = self.repo.get_all()
        # Filter out provisioning assets
        filtered = [a for a in assets if not self._is_provisioning_asset(a)]
        
        if search:
            s = search.lower()
            filtered = [a for a in filtered if s in a.name.lower() or (a.description and s in a.description.lower())]
        
        filtered.sort(key=lambda a: a.name.lower())
        return [self.asset_to_out(a) for a in filtered]

    def get_asset(self, asset_id: int) -> Optional[Dict[str, Any]]:
        a = self.repo.get_by_id(asset_id)
        if not a or self._is_provisioning_asset(a):
            return None
        return self.asset_to_out(a)

    def get_asset_by_name(self, name: str) -> Optional[Asset]:
        a = self.repo.get_by_name(name)
        if not a or self._is_provisioning_asset(a):
            return None
        return a

    def get_credential_value(self, a: Asset) -> dict:
        typ = self._normalize_asset_type(a.type)
        if typ != "credential":
            raise ValueError("Asset is not a credential")
        try:
            obj = json.loads(a.value or "{}")
            return {
                "username": obj.get("username", ""),
                "password": obj.get("password", "")  # This is the raw encrypted password
            }
        except Exception:
            return {"username": "", "password": ""}

    def update_asset_by_name(self, name: str, payload: Dict[str, Any], user: Any, request: Any, is_raw: bool = False) -> Dict[str, Any]:
        a = self.repo.get_by_name(name)
        if not a or self._is_provisioning_asset(a):
            raise ValueError("Asset not found")
        
        before_out = self.asset_to_out(a)
        cur_type = self._normalize_asset_type(a.type)
        new_store_id: Optional[int] = a.credential_store_id

        if cur_type in {"text", "int", "bool"}:
            if "value" in payload and payload["value"] is not None:
                a.value = str(payload["value"]).strip()
        elif cur_type == "secret":
            if "value" in payload and payload["value"]:
                val = str(payload["value"]).strip()
                # If is_raw is True, we assume it's already encrypted
                a.value = val if is_raw else encrypt_value(val)
            new_store_id = self._resolve_store_id(payload.get("credential_store_id")) if "credential_store_id" in payload or a.credential_store_id is None else a.credential_store_id
        elif cur_type == "credential":
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
                pwd = str(password).strip()
                # If is_raw is True, we assume it's already encrypted
                current["password"] = pwd if is_raw else encrypt_value(pwd)
            a.value = json.dumps({
                "username": current.get("username", ""),
                "password": current.get("password", "")
            })
            new_store_id = self._resolve_store_id(payload.get("credential_store_id")) if "credential_store_id" in payload or a.credential_store_id is None else a.credential_store_id

        if "description" in payload:
            a.description = payload.get("description") or None
        
        if cur_type in {"secret", "credential"}:
            a.credential_store_id = new_store_id or self._get_default_store_id()
        else:
            a.credential_store_id = None

        a.updated_at = now_iso()
        self.repo.update(a)
        after_out = self.asset_to_out(a)
        
        try:
            changes = diff_dicts(before_out, after_out)
            # handle cases where user might be a Robot model or None
            actor_name = None
            if hasattr(user, "username"):
                actor_name = user.username
            elif hasattr(user, "name"): # Robot has 'name'
                actor_name = f"robot:{user.name}"
            
            log_event(
                self.session, 
                action="asset.update", 
                entity_type="asset", 
                entity_id=a.id, 
                entity_name=a.name, 
                before=before_out, 
                after=after_out, 
                metadata={"changed_keys": list(changes.keys()), "diff": changes, "runtime_update": is_raw}, 
                request=request, 
                user=user if hasattr(user, "id") and not hasattr(user, "api_token") else None,
                actor_username=actor_name
            )
        except Exception:
            pass
        return after_out

    def create_asset(self, payload: Dict[str, Any], user: Any, request: Any) -> Dict[str, Any]:
        name = (payload.get("name") or "").strip()
        if not name:
            raise ValueError("Name is required")
        if self.repo.get_by_name(name):
            raise ValueError("An asset with this name already exists")
        
        asset_type = self._normalize_asset_type(payload.get("type") or "text")
        stored_value = ""
        is_secret = False
        credential_store_id: Optional[int] = None

        if asset_type in {"text", "int", "bool"}:
            value = (payload.get("value") or "").strip()
            if not value:
                raise ValueError("Value is required")
            stored_value = value
            is_secret = False
        elif asset_type == "secret":
            value = (payload.get("value") or "").strip()
            if not value:
                raise ValueError("Value is required for secret")
            stored_value = encrypt_value(value)
            is_secret = True
            credential_store_id = self._resolve_store_id(payload.get("credential_store_id"))
        elif asset_type == "credential":
            username = (payload.get("username") or "").strip()
            password = (payload.get("password") or "").strip()
            if not username or not password:
                raise ValueError("Username and password are required for credential")
            stored_value = json.dumps({
                "username": username,
                "password": encrypt_value(password)
            })
            is_secret = True
            credential_store_id = self._resolve_store_id(payload.get("credential_store_id"))

        a = Asset(
            name=name,
            type=asset_type,
            value=stored_value,
            is_secret=is_secret,
            credential_store_id=credential_store_id,
            description=payload.get("description") or None,
            created_at=now_iso(),
            updated_at=now_iso(),
        )
        self.repo.create(a)
        out = self.asset_to_out(a)
        try:
            log_event(self.session, action="asset.create", entity_type="asset", entity_id=a.id, entity_name=a.name, before=None, after=out, metadata=None, request=request, user=user)
        except Exception:
            pass
        return out

    def update_asset(self, asset_id: int, payload: Dict[str, Any], user: Any, request: Any) -> Dict[str, Any]:
        a = self.repo.get_by_id(asset_id)
        if not a:
            raise ValueError("Asset not found")
        
        before_out = self.asset_to_out(a)
        if "name" in payload and payload["name"]:
            new_name = payload["name"].strip()
            if new_name != a.name:
                if self.repo.get_by_name(new_name):
                    raise ValueError("An asset with this name already exists")
                a.name = new_name
        
        if "type" in payload and payload["type"]:
            a.type = self._normalize_asset_type(str(payload["type"]))

        cur_type = self._normalize_asset_type(a.type)
        new_store_id: Optional[int] = a.credential_store_id
        if "credential_store_id" in payload:
            new_store_id = self._resolve_store_id(payload.get("credential_store_id"))

        if cur_type in {"text", "int", "bool"}:
            if "value" in payload and payload["value"] is not None:
                a.value = str(payload["value"]).strip()
            a.is_secret = False
            new_store_id = None
        elif cur_type == "secret":
            if "value" in payload and payload["value"]:
                a.value = encrypt_value(str(payload["value"]).strip())
            a.is_secret = True
            new_store_id = self._resolve_store_id(payload.get("credential_store_id")) if "credential_store_id" in payload or a.credential_store_id is None else a.credential_store_id
        elif cur_type == "credential":
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
                current["password"] = encrypt_value(str(password).strip())
            a.value = json.dumps({
                "username": current.get("username", ""),
                "password": current.get("password", current.get("password_hash", "")) # migration path
            })
            a.is_secret = True
            new_store_id = self._resolve_store_id(payload.get("credential_store_id")) if "credential_store_id" in payload or a.credential_store_id is None else a.credential_store_id

        if "description" in payload:
            a.description = payload.get("description") or None

        if cur_type in {"secret", "credential"}:
            a.credential_store_id = new_store_id or self._get_default_store_id()
        else:
            a.credential_store_id = None
        
        a.updated_at = now_iso()
        self.repo.update(a)
        after_out = self.asset_to_out(a)
        try:
            changes = diff_dicts(before_out, after_out)
            log_event(self.session, action="asset.update", entity_type="asset", entity_id=a.id, entity_name=a.name, before=before_out, after=after_out, metadata={"changed_keys": list(changes.keys()), "diff": changes}, request=request, user=user)
        except Exception:
            pass
        return after_out

    def delete_asset(self, asset_id: int, user: Any, request: Any) -> None:
        a = self.repo.get_by_id(asset_id)
        if not a:
            raise ValueError("Asset not found")
        before_out = self.asset_to_out(a)
        self.repo.delete(a)
        try:
            log_event(self.session, action="asset.delete", entity_type="asset", entity_id=asset_id, entity_name=before_out.get("name"), before=before_out, after=None, metadata=None, request=request, user=user)
        except Exception:
            pass

    def _normalize_asset_type(self, raw: str) -> str:
        v = (raw or "").strip().lower()
        if v in {"text", "int", "bool", "secret", "credential"}:
            return v
        if v == "integer": return "int"
        if v == "boolean": return "bool"
        if v == "credentials": return "credential"
        raise ValueError("Invalid asset type")

    def _is_provisioning_asset(self, a: Asset) -> bool:
        name = (a.name or "").lower()
        desc = (a.description or "").lower()
        return name.startswith("robot_") or "credential for robot" in desc

    def asset_to_out(self, a: Asset) -> dict:
        typ = self._normalize_asset_type(a.type)
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
            "credential_store_id": a.credential_store_id,
            "description": a.description,
            "created_at": a.created_at,
            "updated_at": a.updated_at,
        }

    def get_decrypted_value(self, a: Asset) -> Any:
        typ = self._normalize_asset_type(a.type)
        if typ == "secret":
            return decrypt_value(a.value)
        elif typ == "credential":
            obj = json.loads(a.value or "{}")
            return {
                "username": obj.get("username"),
                "password": decrypt_value(obj.get("password", obj.get("password_hash", "")))
            }
        return a.value

