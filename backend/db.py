import logging
import os
from sqlalchemy import event
from sqlmodel import SQLModel, Session, create_engine, select

DB_PATH = os.path.join(os.path.dirname(__file__), "app.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_size=20,
    max_overflow=40,
    pool_timeout=60,
    pool_pre_ping=True,
    connect_args={"check_same_thread": False},
)

pool_logger = logging.getLogger("db.pool")


@event.listens_for(engine, "checkout")
def _on_checkout(dbapi_con, con_record, con_proxy):
    pool_logger.debug("DB connection checked out", extra={"conn_id": id(dbapi_con)})


@event.listens_for(engine, "checkin")
def _on_checkin(dbapi_con, con_record):
    pool_logger.debug("DB connection returned", extra={"conn_id": id(dbapi_con)})

def init_db():
    # Ensure models are imported so SQLModel is aware of all tables
    from backend.models import (
        User,
        Robot,
        Machine,
        Process,
        Job,
        JobExecutionLog,
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
        Trigger,
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

            # Machines: runner key + signature binding
            rows = conn.exec_driver_sql("PRAGMA table_info(machines)").fetchall()
            cols = {r[1] for r in rows}
            if "machine_key_hash" not in cols:
                conn.exec_driver_sql("ALTER TABLE machines ADD COLUMN machine_key_hash TEXT")
            if "signature_hash" not in cols:
                conn.exec_driver_sql("ALTER TABLE machines ADD COLUMN signature_hash TEXT")

            # Packages: bvpackage support
            rows = conn.exec_driver_sql("PRAGMA table_info(packages)").fetchall()
            cols = {r[1] for r in rows}
            if "is_bvpackage" not in cols:
                conn.exec_driver_sql("ALTER TABLE packages ADD COLUMN is_bvpackage INTEGER DEFAULT 0")
            if "entrypoints" not in cols:
                conn.exec_driver_sql("ALTER TABLE packages ADD COLUMN entrypoints TEXT")
            if "default_entrypoint" not in cols:
                conn.exec_driver_sql("ALTER TABLE packages ADD COLUMN default_entrypoint TEXT")
            if "hash" not in cols:
                conn.exec_driver_sql("ALTER TABLE packages ADD COLUMN hash TEXT")
            if "size_bytes" not in cols:
                conn.exec_driver_sql("ALTER TABLE packages ADD COLUMN size_bytes INTEGER")

            # indexes for uniqueness / lookups
            conn.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS uq_packages_name_version ON packages(name, version)")
            conn.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS uq_packages_hash ON packages(hash)")

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
            if "execution_id" not in cols:
                conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN execution_id TEXT")
            if "source" not in cols:
                conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN source TEXT")
            if "trigger_id" not in cols:
                conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN trigger_id TEXT")
            if "queue_item_ids" not in cols:
                conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN queue_item_ids TEXT")

            # Queues enhancements
            rows = conn.exec_driver_sql("PRAGMA table_info(queues)").fetchall()
            cols = {r[1] for r in rows}
            if "description" not in cols:
                conn.exec_driver_sql("ALTER TABLE queues ADD COLUMN description TEXT")
            if "is_active" not in cols:
                conn.exec_driver_sql("ALTER TABLE queues ADD COLUMN is_active INTEGER DEFAULT 1")
            else:
                # Ensure default is set
                conn.exec_driver_sql("ALTER TABLE queues ALTER COLUMN is_active SET DEFAULT 1")
                # Backfill any NULL values to 1
                conn.exec_driver_sql("UPDATE queues SET is_active = 1 WHERE is_active IS NULL")
            if "max_retries" not in cols:
                conn.exec_driver_sql("ALTER TABLE queues ADD COLUMN max_retries INTEGER DEFAULT 0")
            if "external_id" not in cols:
                conn.exec_driver_sql("ALTER TABLE queues ADD COLUMN external_id TEXT")
                conn.exec_driver_sql("UPDATE queues SET external_id = lower(hex(randomblob(16))) WHERE external_id IS NULL")
                conn.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS uq_queues_external_id ON queues(external_id)")
            if "enforce_unique_reference" not in cols:
                conn.exec_driver_sql("ALTER TABLE queues ADD COLUMN enforce_unique_reference INTEGER DEFAULT 0")
            # Ensure existing rows have the default value
            conn.exec_driver_sql("UPDATE queues SET enforce_unique_reference = 0 WHERE enforce_unique_reference IS NULL")

            rows = conn.exec_driver_sql("PRAGMA table_info(queue_items)").fetchall()
            cols = {r[1] for r in rows}
            # Check if id column is still INTEGER (old schema) and needs migration to TEXT
            id_col = next((r for r in rows if r[1] == 'id'), None)
            if id_col and id_col[2] == 'INTEGER':
                # Migrate queue_items table to use TEXT id
                print("Migrating queue_items table id from INTEGER to TEXT...")
                # Since this is dev and we have foreign key issues, drop and recreate for simplicity
                conn.exec_driver_sql("DROP TABLE IF EXISTS queue_items")
                # Recreate with new schema
                conn.exec_driver_sql("""
                    CREATE TABLE queue_items (
                        id TEXT PRIMARY KEY,
                        queue_id INTEGER NOT NULL,
                        reference TEXT UNIQUE,
                        status TEXT NOT NULL,
                        priority INTEGER NOT NULL DEFAULT 0,
                        payload TEXT,
                        result TEXT,
                        error_message TEXT,
                        retries INTEGER NOT NULL DEFAULT 0,
                        locked_by_robot_id INTEGER,
                        locked_at TEXT,
                        job_id INTEGER,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                """)
                conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_queue_items_queue_id_status ON queue_items(queue_id, status)")
            else:
                # Add missing columns to existing table
                if "reference" not in cols:
                    conn.exec_driver_sql("ALTER TABLE queue_items ADD COLUMN reference TEXT")
                if "priority" not in cols:
                    conn.exec_driver_sql("ALTER TABLE queue_items ADD COLUMN priority INTEGER DEFAULT 0")
                if "payload" not in cols:
                    conn.exec_driver_sql("ALTER TABLE queue_items ADD COLUMN payload TEXT")
                if "result" not in cols:
                    conn.exec_driver_sql("ALTER TABLE queue_items ADD COLUMN result TEXT")
                if "error_message" not in cols:
                    conn.exec_driver_sql("ALTER TABLE queue_items ADD COLUMN error_message TEXT")
                if "retries" not in cols:
                    conn.exec_driver_sql("ALTER TABLE queue_items ADD COLUMN retries INTEGER DEFAULT 0")
                if "locked_by_robot_id" not in cols:
                    conn.exec_driver_sql("ALTER TABLE queue_items ADD COLUMN locked_by_robot_id INTEGER")
                if "locked_at" not in cols:
                    conn.exec_driver_sql("ALTER TABLE queue_items ADD COLUMN locked_at TEXT")
                if "job_id" not in cols:
                    conn.exec_driver_sql("ALTER TABLE queue_items ADD COLUMN job_id INTEGER")
                conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_queue_items_queue_id_status ON queue_items(queue_id, status)")
                # Remove unique constraint on reference since it's now optional per queue
                try:
                    conn.exec_driver_sql("DROP INDEX IF EXISTS uq_queue_items_queue_id_reference")
                except:
                    pass  # Index might not exist

            # Triggers table
            rows = conn.exec_driver_sql("PRAGMA table_info(triggers)").fetchall()
            cols = {r[1] for r in rows}
            if not rows:
                conn.exec_driver_sql(
                    """
                    CREATE TABLE IF NOT EXISTS triggers (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        type TEXT NOT NULL,
                        process_id INTEGER NOT NULL,
                        enabled INTEGER DEFAULT 1,
                        robot_id INTEGER,
                        cron_expression TEXT,
                        timezone TEXT,
                        last_fired_at TEXT,
                        next_fire_at TEXT,
                        queue_id INTEGER,
                        batch_size INTEGER,
                        polling_interval INTEGER,
                        last_processed_item_id INTEGER,
                        created_at TEXT,
                        updated_at TEXT
                    )
                    """
                )
            else:
                if "cron_expression" not in cols:
                    conn.exec_driver_sql("ALTER TABLE triggers ADD COLUMN cron_expression TEXT")
                if "timezone" not in cols:
                    conn.exec_driver_sql("ALTER TABLE triggers ADD COLUMN timezone TEXT")
                if "last_fired_at" not in cols:
                    conn.exec_driver_sql("ALTER TABLE triggers ADD COLUMN last_fired_at TEXT")
                if "next_fire_at" not in cols:
                    conn.exec_driver_sql("ALTER TABLE triggers ADD COLUMN next_fire_at TEXT")
                if "queue_id" not in cols:
                    conn.exec_driver_sql("ALTER TABLE triggers ADD COLUMN queue_id INTEGER")
                if "batch_size" not in cols:
                    conn.exec_driver_sql("ALTER TABLE triggers ADD COLUMN batch_size INTEGER")
                if "polling_interval" not in cols:
                    conn.exec_driver_sql("ALTER TABLE triggers ADD COLUMN polling_interval INTEGER")
                if "last_processed_item_id" not in cols:
                    conn.exec_driver_sql("ALTER TABLE triggers ADD COLUMN last_processed_item_id INTEGER")
            conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_triggers_type_enabled ON triggers(type, enabled)")

            # Role permissions table
            rows = conn.exec_driver_sql("PRAGMA table_info(role_permissions)").fetchall()
            cols = {r[1] for r in rows}
            if not rows:
                conn.exec_driver_sql(
                    """
                    CREATE TABLE IF NOT EXISTS role_permissions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        role_id INTEGER NOT NULL,
                        artifact TEXT NOT NULL,
                        can_view INTEGER DEFAULT 0,
                        can_create INTEGER DEFAULT 0,
                        can_edit INTEGER DEFAULT 0,
                        can_delete INTEGER DEFAULT 0
                    )
                    """
                )
                conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_role_permissions_role_id_artifact ON role_permissions(role_id, artifact)")
            else:
                if "can_view" not in cols:
                    conn.exec_driver_sql("ALTER TABLE role_permissions ADD COLUMN can_view INTEGER DEFAULT 0")
                if "can_create" not in cols:
                    conn.exec_driver_sql("ALTER TABLE role_permissions ADD COLUMN can_create INTEGER DEFAULT 0")
                if "can_edit" not in cols:
                    conn.exec_driver_sql("ALTER TABLE role_permissions ADD COLUMN can_edit INTEGER DEFAULT 0")
                if "can_delete" not in cols:
                    conn.exec_driver_sql("ALTER TABLE role_permissions ADD COLUMN can_delete INTEGER DEFAULT 0")
                conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_role_permissions_role_id_artifact ON role_permissions(role_id, artifact)")
            conn.commit()

        # Backfill execution_id for existing jobs (best-effort)
        try:
            from backend.models import Job  # noqa: WPS433
            with Session(engine) as session:
                missing = session.exec(select(Job).where((Job.execution_id == None) | (Job.execution_id == ""))).all()  # noqa: E711
                if missing:
                    import uuid
                    for j in missing:
                        j.execution_id = str(uuid.uuid4())
                        session.add(j)
                    session.commit()
        except Exception:
            pass
    except Exception:
        # best-effort; dev DB can be reset by deleting backend/app.db
        pass

def get_session():
    with Session(engine) as session:
        yield session
