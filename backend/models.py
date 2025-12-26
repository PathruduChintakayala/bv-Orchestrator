from typing import Optional
from sqlmodel import SQLModel, Field

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    password_hash: str
    is_admin: bool = False
    full_name: Optional[str] = None
    email: Optional[str] = Field(default=None, index=True, unique=True)
    organization: Optional[str] = None
    role: Optional[str] = None

class Process(SQLModel, table=True):
    __tablename__ = "processes"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    description: Optional[str] = None
    package_id: Optional[int] = None
    script_path: str
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
    scripts_manifest: Optional[str] = None
    is_active: bool = True
    created_at: str
    updated_at: str

class Robot(SQLModel, table=True):
    __tablename__ = "robots"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    status: str = Field(default="offline")  # "online" | "offline"
    last_heartbeat: Optional[str] = None
    current_job_id: Optional[int] = None
    machine_info: Optional[str] = None
    api_token: Optional[str] = None
    created_at: str
    updated_at: str

class Job(SQLModel, table=True):
    __tablename__ = "jobs"
    id: Optional[int] = Field(default=None, primary_key=True)
    process_id: int
    package_id: Optional[int] = None
    robot_id: Optional[int] = None
    status: str = Field(default="pending")  # "pending" | "running" | "completed" | "failed" | "canceled"
    parameters: Optional[str] = None
    result: Optional[str] = None
    error_message: Optional[str] = None
    logs_path: Optional[str] = None
    created_at: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None

class Asset(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    type: str  # "text" | "int" | "bool" | "secret" | "credential"
    value: str
    is_secret: bool = False
    description: Optional[str] = None
    created_at: str
    updated_at: str

class Queue(SQLModel, table=True):
    __tablename__ = "queues"
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    description: Optional[str] = None
    is_active: bool = True
    max_retries: int = 0
    created_at: str
    updated_at: str

class QueueItem(SQLModel, table=True):
    __tablename__ = "queue_items"
    id: Optional[int] = Field(default=None, primary_key=True)
    queue_id: int = Field(index=True)
    reference: Optional[str] = Field(default=None, index=True)
    status: str = Field(default="new")  # new | in_progress | completed | failed | abandoned
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
    artifact: str
    can_view: bool = False
    can_create: bool = False
    can_edit: bool = False
    can_delete: bool = False

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
