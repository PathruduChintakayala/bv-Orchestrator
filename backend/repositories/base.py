from typing import Generic, TypeVar, Type, Optional, List, Any
from sqlmodel import Session, select, SQLModel

T = TypeVar("T", bound=SQLModel)

class BaseRepository(Generic[T]):
    def __init__(self, model: Type[T], session: Session):
        self.model = model
        self.session = session

    def get_by_id(self, id: Any) -> Optional[T]:
        return self.session.get(self.model, id)

    def get_all(self) -> List[T]:
        return self.session.exec(select(self.model)).all()

    def create(self, obj: T) -> T:
        self.session.add(obj)
        self.session.commit()
        self.session.refresh(obj)
        return obj

    def update(self, obj: T) -> T:
        self.session.add(obj)
        self.session.commit()
        self.session.refresh(obj)
        return obj

    def delete(self, obj: T) -> None:
        self.session.delete(obj)
        self.session.commit()

