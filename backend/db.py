from sqlmodel import SQLModel, create_engine, Session
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "app.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, echo=False)

def init_db():
    # Ensure models are imported so SQLModel is aware of all tables
    from .models import (
        User,
        Robot,
        Process,
        Job,
        Asset,
        Package,
        Queue,
        QueueItem,
        Role,
        RolePermission,
        UserRole,
        AuditEvent,
        Setting,
    )  # noqa: F401
    SQLModel.metadata.create_all(engine)

def get_session() -> Session:
    return Session(engine)
