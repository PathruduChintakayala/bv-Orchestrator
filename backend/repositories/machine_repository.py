import hashlib
from typing import Optional
from sqlmodel import select
from backend.models import Machine
from backend.repositories.base import BaseRepository

def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

class MachineRepository(BaseRepository[Machine]):
    def __init__(self, session):
        super().__init__(Machine, session)

    def get_by_key(self, machine_key: str) -> Optional[Machine]:
        mk_hash = _sha256_hex(machine_key.strip())
        return self.session.exec(select(Machine).where(Machine.machine_key_hash == mk_hash)).first()

