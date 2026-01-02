import logging
import os
from sqlalchemy import event
from sqlmodel import create_engine, Session

# Use DATABASE_URL from environment, default to SQLite for local development outside Docker
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db")

# Adjust engine parameters based on database type
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_size=20,
    max_overflow=40,
    pool_timeout=60,
    pool_pre_ping=True,
    connect_args=connect_args,
)

pool_logger = logging.getLogger("db.pool")

@event.listens_for(engine, "checkout")
def _on_checkout(dbapi_con, con_record, con_proxy):
    pool_logger.debug("DB connection checked out", extra={"conn_id": id(dbapi_con)})

@event.listens_for(engine, "checkin")
def _on_checkin(dbapi_con, con_record):
    pool_logger.debug("DB connection returned", extra={"conn_id": id(dbapi_con)})

def init_db():
    # In production with Docker, migrations are handled by Alembic.
    # We still keep this for dev, but we don't need the manual ALTER TABLEs anymore
    # as PostgreSQL will be initialized with the latest schema via Alembic.
    from sqlmodel import SQLModel
    from backend.models import (
        User, Robot, Machine, Process, Job, JobExecutionLog,
        Asset, Package, Queue, QueueItem, Role, RolePermission,
        UserRole, AuditEvent, Setting, SdkAuthSession, Trigger
    )  # noqa: F401
    
    if DATABASE_URL.startswith("sqlite"):
        SQLModel.metadata.create_all(engine)
    else:
        # For Postgres, we assume Alembic has run or we create if it doesn't exist
        # but create_all is idempotent and safe.
        SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session
