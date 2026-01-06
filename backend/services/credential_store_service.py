from datetime import datetime
from typing import Any, Dict, List, Optional
from sqlmodel import Session, select
from backend.models import CredentialStore, CredentialStoreType
from backend.repositories.credential_store_repository import CredentialStoreRepository
from backend.encryption import encrypt_value


def now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds")


class CredentialStoreService:
    def __init__(self, session: Session):
        self.session = session
        self.repo = CredentialStoreRepository(session)

    def ensure_default_store(self) -> CredentialStore:
        existing = self.repo.get_default()
        if existing:
            if not existing.is_active:
                existing.is_active = True
                existing.updated_at = now_iso()
                self.repo.update(existing)
            return existing
        store = CredentialStore(
            name="Orchestrator Store",
            type=CredentialStoreType.INTERNAL_DB,
            is_default=True,
            is_active=True,
            description="Built-in credential store backed by the orchestrator database",
            config=None,
            created_at=now_iso(),
            updated_at=now_iso(),
        )
        return self.repo.create(store)

    def list_stores(self) -> List[Dict[str, Any]]:
        stores = self.repo.get_all()
        stores.sort(key=lambda s: (not s.is_default, s.name.lower()))
        return [self._to_out(s) for s in stores]

    def create_store(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        name = (payload.get("name") or "").strip()
        if not name:
            raise ValueError("Name is required")
        if self.repo.get_by_name(name):
            raise ValueError("A credential store with this name already exists")

        store_type = self._normalize_type(payload.get("type"))
        is_default = bool(payload.get("is_default"))
        if is_default:
            raise ValueError("Default store already exists and cannot be replaced in this release")

        is_active = bool(payload.get("is_active", False)) if store_type == CredentialStoreType.INTERNAL_DB else False
        description = payload.get("description") or ("Coming soon" if store_type != CredentialStoreType.INTERNAL_DB else None)
        config = self._serialize_config(payload.get("config"))

        store = CredentialStore(
            name=name,
            type=store_type,
            is_default=False,
            is_active=is_active,
            description=description,
            config=config,
            created_at=now_iso(),
            updated_at=now_iso(),
        )
        created = self.repo.create(store)
        return self._to_out(created)

    def update_store(self, store_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        store = self.repo.get_by_id(store_id)
        if not store:
            raise ValueError("Credential store not found")

        if store.is_default:
            if payload.get("is_default") is False:
                raise ValueError("Default store cannot be unset")
            if payload.get("is_active") is False:
                raise ValueError("Default store cannot be disabled")

        if (nm := payload.get("name")) is not None:
            nm = nm.strip()
            if not nm:
                raise ValueError("Name cannot be empty")
            other = self.session.exec(
                select(CredentialStore).where(CredentialStore.name == nm, CredentialStore.id != store_id)
            ).first()
            if other:
                raise ValueError("A credential store with this name already exists")
            store.name = nm

        if payload.get("type") is not None and payload.get("type") != store.type:
            raise ValueError("Store type cannot be changed")

        if payload.get("description") is not None:
            store.description = payload.get("description") or None

        if payload.get("config") is not None:
            store.config = self._serialize_config(payload.get("config"))

        if payload.get("is_active") is not None and not store.is_default:
            store.is_active = bool(payload.get("is_active"))

        if payload.get("is_default") is True and not store.is_default:
            raise ValueError("Switching default stores is not supported yet")

        store.updated_at = now_iso()
        updated = self.repo.update(store)
        return self._to_out(updated)

    def _serialize_config(self, cfg: Optional[Dict[str, Any]]) -> Optional[str]:
        if not cfg:
            return None
        # Future stores may need encryption; store encrypted JSON to avoid leaking secrets
        try:
            import json
            return encrypt_value(json.dumps(cfg))
        except Exception:
            return None

    def _normalize_type(self, raw: Any) -> CredentialStoreType:
        if not raw:
            return CredentialStoreType.INTERNAL_DB
        try:
            return CredentialStoreType[str(raw).upper()]
        except Exception:
            raise ValueError("Invalid credential store type")

    def _to_out(self, store: CredentialStore) -> Dict[str, Any]:
        status = "Coming soon" if store.type != CredentialStoreType.INTERNAL_DB else ("Active" if store.is_active else "Inactive")
        return {
            "id": getattr(store, "external_id", None) or str(store.id),
            "_internal_id": store.id,  # deprecated: prefer id (external_id)
            "name": store.name,
            "type": store.type,
            "is_default": store.is_default,
            "is_active": store.is_active,
            "status_label": status,
            "description": store.description,
            "created_at": store.created_at,
            "updated_at": store.updated_at,
        }
