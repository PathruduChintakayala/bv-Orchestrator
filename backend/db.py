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
        Machine,
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
        SdkAuthSession,
    )  # noqa: F401
    SQLModel.metadata.create_all(engine)

    # Lightweight dev migration for SQLite (create_all does not add columns).
    try:
        with engine.connect() as conn:
            rows = conn.exec_driver_sql("PRAGMA table_info(robots)").fetchall()
            cols = {r[1] for r in rows}  # name is index 1
            if "machine_id" not in cols:
                conn.exec_driver_sql("ALTER TABLE robots ADD COLUMN machine_id INTEGER")
            if "credential_asset_id" not in cols:
                conn.exec_driver_sql("ALTER TABLE robots ADD COLUMN credential_asset_id INTEGER")

            # Packages: bvpackage support
            rows = conn.exec_driver_sql("PRAGMA table_info(packages)").fetchall()
            cols = {r[1] for r in rows}
            if "is_bvpackage" not in cols:
                conn.exec_driver_sql("ALTER TABLE packages ADD COLUMN is_bvpackage INTEGER DEFAULT 0")
            if "entrypoints" not in cols:
                conn.exec_driver_sql("ALTER TABLE packages ADD COLUMN entrypoints TEXT")
            if "default_entrypoint" not in cols:
                conn.exec_driver_sql("ALTER TABLE packages ADD COLUMN default_entrypoint TEXT")

            # Processes: bvpackage entrypoint reference
            rows = conn.exec_driver_sql("PRAGMA table_info(processes)").fetchall()
            cols = {r[1] for r in rows}
            if "entrypoint_name" not in cols:
                conn.exec_driver_sql("ALTER TABLE processes ADD COLUMN entrypoint_name TEXT")

            # Jobs: snapshot fields
            rows = conn.exec_driver_sql("PRAGMA table_info(jobs)").fetchall()
            cols = {r[1] for r in rows}
            if "package_name" not in cols:
                conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN package_name TEXT")
            if "package_version" not in cols:
                conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN package_version TEXT")
            if "entrypoint_name" not in cols:
                conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN entrypoint_name TEXT")
            conn.commit()
    except Exception:
        # best-effort; dev DB can be reset by deleting backend/app.db
        pass

def get_session() -> Session:
    return Session(engine)
