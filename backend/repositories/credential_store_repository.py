from typing import Optional
from sqlmodel import select
from backend.models import CredentialStore
from backend.repositories.base import BaseRepository

class CredentialStoreRepository(BaseRepository[CredentialStore]):
    def __init__(self, session):
        super().__init__(CredentialStore, session)

    def get_by_name(self, name: str) -> Optional[CredentialStore]:
        return self.session.exec(select(CredentialStore).where(CredentialStore.name == name)).first()

    def get_default(self) -> Optional[CredentialStore]:
        return self.session.exec(select(CredentialStore).where(CredentialStore.is_default == True)).first()

    def get_active_default(self) -> Optional[CredentialStore]:
        return self.session.exec(select(CredentialStore).where(CredentialStore.is_default == True, CredentialStore.is_active == True)).first()
