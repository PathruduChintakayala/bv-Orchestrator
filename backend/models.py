from __future__ import annotations

from typing import Optional, Annotated
from datetime import datetime
from uuid import uuid4
from sqlalchemy import Index
from sqlmodel import SQLModel, Field
from enum import Enum


class TriggerType(str, Enum):
    TIME = "TIME"
    QUEUE = "QUEUE"


class CredentialStoreType(str, Enum):
    INTERNAL_DB = "INTERNAL_DB"
    AZURE_KEY_VAULT = "AZURE_KEY_VAULT"
    CYBERARK = "CYBERARK"
    AWS_SECRETS_MANAGER = "AWS_SECRETS_MANAGER"
    HASHICORP_VAULT = "HASHICORP_VAULT"


class CredentialStore(SQLModel, table=True):
    __tablename__ = "credential_store"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    type: CredentialStoreType = Field(index=True)
    is_default: bool = Field(default=False, index=True)
    is_active: bool = Field(default=True, index=True)
    description: Optional[str] = None
    config: Optional[str] = None  # encrypted JSON
    created_at: str
    updated_at: str


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    password_hash: str
    is_admin: bool = False
    is_active: bool = Field(default=True, index=True)
    disabled_at: Optional[datetime] = Field(default=None, index=True)
    disabled_by_user_id: Optional[int] = Field(default=None, index=True)
    failed_login_attempts: int = Field(default=0)
    last_failed_login_at: Optional[datetime] = Field(default=None, index=True)
    locked_until: Optional[datetime] = Field(default=None, index=True)
    token_version: int = Field(default=1)
    last_login: Optional[datetime] = Field(default=None, index=True)
    full_name: Optional[str] = None
    email: Optional[str] = Field(default=None, index=True, unique=True)
    organization: Optional[str] = None
    role: Optional[str] = None
    preferences_json: Optional[str] = None
    avatar_url: Optional[str] = None
    avatar_updated_at: Optional[datetime] = Field(default=None, index=True)

class Process(SQLModel, table=True):
    __tablename__ = "processes"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    description: Optional[str] = None
    package_id: Optional[int] = None
    # Legacy packages use script_path. BV packages use entrypoint_name.
    # NOTE: Kept as required str for backward compatibility with existing DB schema.
    script_path: str
    entrypoint_name: Optional[str] = Field(default=None, index=True)
    is_active: bool = True
    version: int = 1
    created_at: str
    updated_at: str

class Package(SQLModel, table=True):
    __tablename__ = "packages"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    version: str
    file_path: str
    hash: Optional[str] = Field(default=None, index=True)
    size_bytes: Optional[int] = Field(default=None)
    scripts_manifest: Optional[str] = None
    is_bvpackage: bool = False
    # JSON string (nullable). Present only when is_bvpackage = True.
    entrypoints: Optional[str] = None
    default_entrypoint: Optional[str] = None
    is_active: bool = True
    created_at: str
    updated_at: str

class Robot(SQLModel, table=True):
    __tablename__ = "robots"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    status: str = Field(default="disconnected")  # "connected" | "disconnected"
    last_heartbeat: Optional[str] = None
    current_job_id: Optional[int] = None
    machine_id: Optional[int] = Field(default=None, index=True)
    machine_info: Optional[str] = None
    credential_asset_id: Optional[int] = Field(default=None, index=True)  # Deprecated, kept for backward compatibility
    username: Optional[str] = None  # Windows username (plain text, e.g., "DOMAIN\username" or "username")
    password_hash: Optional[str] = None  # Windows password hash (bcrypt)
    api_token: Optional[str] = None
    created_at: str
    updated_at: str


class Machine(SQLModel, table=True):
    __tablename__ = "machines"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    mode: str  # "dev" | "runner"
    status: str  # "connected" | "disconnected"
    created_at: str
    updated_at: str
    last_seen_at: Optional[str] = None
    # Never returned except at creation time (plain key not stored)
    machine_key_hash: Optional[str] = None
    # Runner-provided signature hash to bind a specific host/OS to this machine
    signature_hash: Optional[str] = None

class Job(SQLModel, table=True):
    __tablename__ = "jobs"
    id: Optional[int] = Field(default=None, primary_key=True)
    execution_id: str = Field(default_factory=lambda: str(uuid4()), index=True, unique=True)
    process_id: int
    package_id: Optional[int] = None
    # Snapshot fields for reproducible execution.
    package_name: Optional[str] = None
    package_version: Optional[str] = None
    entrypoint_name: Optional[str] = None
    source: Optional[str] = Field(default=None, index=True)  # e.g., TRIGGER | MANUAL | SDK
    trigger_id: Optional[str] = Field(default=None, index=True)
    queue_item_ids: Optional[str] = None  # JSON array of queue item IDs claimed by this job
    robot_id: Optional[int] = None
    machine_name: Optional[str] = None  # Snapshot of machine name when job started running
    status: str = Field(default="pending")  # "pending" | "running" | "completed" | "failed" | "canceled"
    parameters: Optional[str] = None
    result: Optional[str] = None
    error_message: Optional[str] = None
    logs_path: Optional[str] = None
    created_at: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None


class JobExecutionLog(SQLModel, table=True):
    __tablename__ = "job_execution_logs"
    __table_args__ = (
        Index("ix_job_execution_logs_job_execution_id_timestamp", "job_execution_id", "timestamp"),
        Index("ix_job_execution_logs_job_execution_id_level", "job_execution_id", "level"),
    )

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    job_execution_id: str = Field(index=True)
    timestamp: datetime = Field(index=True)
    level: str = Field(index=True)
    message: str
    process_id: Optional[int] = None
    process_name: Optional[str] = None
    machine_id: Optional[int] = None
    machine_name: Optional[str] = None
    host_name: Optional[str] = None  # Machine name at log creation time
    host_identity: Optional[str] = None  # Robot username at log creation time
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)

class Asset(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    type: str  # "text" | "int" | "bool" | "secret" | "credential"
    value: str
    is_secret: bool = False
    credential_store_id: Optional[int] = Field(default=None, foreign_key="credential_store.id", index=True)
    description: Optional[str] = None
    created_at: str
    updated_at: str

class Queue(SQLModel, table=True):
    __tablename__ = "queues"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    description: Optional[str] = None
    max_retries: int = 0
    enforce_unique_reference: bool = False
    is_active: bool = True
    created_at: str
    updated_at: str
    external_id: Optional[str] = Field(default_factory=lambda: str(uuid4()), index=True, unique=True)

class QueueItem(SQLModel, table=True):
    __tablename__ = "queue_items"
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    queue_id: int = Field(index=True)
    reference: Optional[str] = Field(default=None, index=True)
    status: str = Field(default="NEW")  # NEW | IN_PROGRESS | DONE | FAILED | DELETED
    priority: int = 0
    payload: Optional[str] = None
    result: Optional[str] = None
    error_message: Optional[str] = None
    retries: int = 0
    locked_by_robot_id: Optional[int] = None
    locked_at: Optional[str] = None
    job_id: Optional[int] = None
    created_at: str
    updated_at: str
    __table_args__ = (
        Index("ix_queue_items_queue_id_status", "queue_id", "status"),
    )

class Role(SQLModel, table=True):
    __tablename__ = "roles"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    description: Optional[str] = None
    created_at: str
    updated_at: str


class RolePermission(SQLModel, table=True):
    __tablename__ = "role_permissions"
    id: Optional[int] = Field(default=None, primary_key=True)
    role_id: int = Field(index=True)
    artifact: str = Field(index=True)
    can_view: bool = Field(default=False)
    can_create: bool = Field(default=False)
    can_edit: bool = Field(default=False)
    can_delete: bool = Field(default=False)


class Trigger(SQLModel, table=True):
    __tablename__ = "triggers"
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    name: str = Field(index=True)
    type: TriggerType = Field(index=True)
    process_id: int = Field(index=True)
    enabled: bool = Field(default=True, index=True)
    robot_id: Optional[int] = Field(default=None, index=True)
    cron_expression: Optional[str] = None
    timezone: Optional[str] = None
    last_fired_at: Optional[str] = None
    next_fire_at: Optional[str] = None
    queue_id: Optional[int] = Field(default=None, index=True)
    batch_size: Optional[int] = None
    polling_interval: Optional[int] = None
    last_processed_item_id: Optional[int] = None
    created_at: str
    updated_at: str
    __table_args__ = (
        Index("ix_triggers_type_enabled", "type", "enabled"),
    )
class UserRole(SQLModel, table=True):
    __tablename__ = "user_roles"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    role_id: int = Field(index=True)


class AuditEvent(SQLModel, table=True):
    __tablename__ = "audit_events"
    id: Optional[int] = Field(default=None, primary_key=True)
    timestamp: str = Field(index=True)
    actor_user_id: Optional[int] = Field(default=None, index=True)
    actor_username: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    action: str = Field(index=True)
    entity_type: Optional[str] = Field(default=None, index=True)
    entity_id: Optional[str] = Field(default=None, index=True)
    entity_name: Optional[str] = None
    before_data: Optional[str] = None
    after_data: Optional[str] = None
    details: Optional[str] = None


class Setting(SQLModel, table=True):
    __tablename__ = "settings"
    id: Optional[int] = Field(default=None, primary_key=True)
    key: str = Field(index=True, unique=True)
    value: str
    type: str  # string | int | bool | json
    scope: str = Field(default="global")
    updated_by_user_id: int
    updated_at: str = Field(index=True)


class SdkAuthSession(SQLModel, table=True):
    __tablename__ = "sdk_auth_sessions"
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: str = Field(index=True, unique=True)
    user_id: Optional[int] = Field(default=None, index=True)
    machine_name: str = Field(index=True)
    status: str = Field(default="pending", index=True)  # pending | confirmed | expired
    expires_at: datetime = Field(index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)


class UserInvite(SQLModel, table=True):
    __tablename__ = "user_invites"
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True)
    token_hash: str = Field(index=True)
    role_ids_json: Optional[str] = None  # JSON array of role IDs to assign on acceptance
    full_name: Optional[str] = None
    organization: Optional[str] = None
    message: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    expires_at: datetime = Field(index=True)
    created_by_user_id: Optional[int] = Field(default=None, index=True)
    accepted_at: Optional[datetime] = Field(default=None, index=True)
    accepted_by_user_id: Optional[int] = Field(default=None, index=True)
    revoked_at: Optional[datetime] = Field(default=None, index=True)


class PasswordResetToken(SQLModel, table=True):
    __tablename__ = "password_reset_tokens"
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    token_hash: str = Field(index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    expires_at: datetime = Field(index=True)
    used_at: Optional[datetime] = Field(default=None, index=True)
    created_ip: Optional[str] = None
