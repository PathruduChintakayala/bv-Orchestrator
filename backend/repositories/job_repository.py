from typing import Optional, List
from sqlmodel import select
from backend.models import Job
from backend.repositories.base import BaseRepository

class JobRepository(BaseRepository[Job]):
    def __init__(self, session):
        super().__init__(Job, session)

    def get_by_execution_id(self, execution_id: str) -> Optional[Job]:
        return self.session.exec(select(Job).where(Job.execution_id == execution_id)).first()

    def get_pending_jobs(self) -> List[Job]:
        return self.session.exec(
            select(Job).where(Job.status == "pending").order_by(Job.created_at)
        ).all()

    def get_jobs(self, status: Optional[str] = None, process_id: Optional[int] = None, robot_id: Optional[int] = None) -> List[Job]:
        stmt = select(Job)
        if status:
            stmt = stmt.where(Job.status == status)
        if process_id:
            stmt = stmt.where(Job.process_id == process_id)
        if robot_id:
            stmt = stmt.where(Job.robot_id == robot_id)
        return self.session.exec(stmt.order_by(Job.created_at.desc())).all()

