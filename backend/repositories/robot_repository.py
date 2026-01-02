from typing import List
from sqlmodel import select
from backend.models import Robot
from backend.repositories.base import BaseRepository

class RobotRepository(BaseRepository[Robot]):
    def __init__(self, session):
        super().__init__(Robot, session)

    def get_by_machine_id(self, machine_id: int) -> List[Robot]:
        return self.session.exec(select(Robot).where(Robot.machine_id == machine_id)).all()

