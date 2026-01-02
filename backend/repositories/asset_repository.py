from typing import List, Optional
from sqlmodel import select
from backend.models import Asset
from backend.repositories.base import BaseRepository

class AssetRepository(BaseRepository[Asset]):
    def __init__(self, session):
        super().__init__(Asset, session)

    def get_by_name(self, name: str) -> Optional[Asset]:
        return self.session.exec(select(Asset).where(Asset.name == name)).first()

    def list_visible_assets(self) -> List[Asset]:
        # Filter out provisioning assets if needed, or handle in service
        return self.session.exec(select(Asset)).all()

