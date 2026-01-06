# BV Orchestrator

Primary system documentation for the BV Orchestrator platform. This document is written for platform architects, backend engineers, UI engineers, and future maintainers. It focuses on how the system works end to end, not just the API surface.

## 1. Platform Overview
- **Responsibility:** Coordinate end-to-end automation execution across RPA robots and agent-style runtimes. Manage packages, processes, jobs, queues, triggers, assets, credentials, users, and permissions. Expose REST APIs for UI, SDK, and runner interactions. Persist system-of-record state, audit activity, and enforce access controls.
- **Out of Scope:** Does not execute automations itself (execution happens in runners/agents). Does not provide low-level desktop/web automation SDKs (those live in the SDK/runtime). Does not manage infrastructure provisioning for runners. Does not provide observability backends beyond emitted logs/audit entries.
- **Fit in the stack:**
  - **Orchestrator (this repo):** Control plane, APIs, scheduling, state, RBAC, assets, queues, triggers, audit.
  - **Runner/Agent:** Data plane that pulls jobs, executes package entrypoints, streams logs/heartbeats, reports results.
  - **SDK:** Used by package authors; defines entrypoints, serialization, and runner protocol expectations.
  - **Runtime:** Executes BV packages or legacy scripts; communicates with orchestrator through the runner protocol.

## 2. Core Concepts
### Packages
Versioned automation bundles (`.bvpackage`). Include entrypoints, signatures, optional assets. Stored and validated by the orchestrator; executed by runners.

### Processes
Definitions that bind a package entrypoint (or legacy script path) plus metadata. A process is the runnable unit for creating jobs. Tracks type (RPA/Agent) and active version.

### Jobs
Requested executions of a process. Carry parameters, optional robot/machine targeting, queue item linkage, status, result/error payloads, retries, and audit trail.

### Executions
Concrete runs of a job on a runner/agent. Capture start/end timestamps, heartbeats, and final status. Jobs may have multiple executions in failure/retry scenarios.

### Robots
Logical executors representing automation workers. Associated with machines; authenticated via tokens/keys. Can be online/offline; receive jobs through pull-based dispatch.

### Machines
Physical/virtual hosts that run robots or agents. Store host identity, capabilities, and regenerated keys. Used for trust and scoping runner access.

### Queues & Queue Items
Work queues for decoupled job intake. Queue items have lifecycle (NEW → IN_PROGRESS → DONE/FAILED/ABANDONED/DELETED) and optional retry semantics. Triggers and jobs can consume items.

### Triggers (time & queue)
Schedulers that create jobs automatically. Time triggers are cron-like with timezone support. Queue triggers fire when items are available, optionally batching.

### Assets
Key-value configuration and secrets (text, int, bool, secret, credential). Used by jobs/runners at execution time. Secrets are masked in API responses; credentials stored securely.

### Credentials
Structured secrets for robots/processes (username/password pairs). Delivered to runners as needed; never logged in plaintext.

### Users, Roles, Permissions
RBAC model. Users belong to roles. Roles define per-artifact permissions (view/create/edit/delete). Permissions gate API access and UI affordances. Audit trail records who did what.

## 3. System Architecture
- **Backend components:** FastAPI app (`backend/`) with routers per artifact (packages, processes, jobs, queues, triggers, assets, access, audit, settings). Uses SQLModel/SQLAlchemy for persistence. Background schedulers (trigger scheduler) run inside the app.
- **Background schedulers:** `trigger_scheduler.py` evaluates time and queue triggers, creates jobs, and handles retry semantics. Long-running daemon within the backend process.
- **API layers:**
  - UI: React frontend calling REST endpoints under `/api`.
  - SDK: Uses the same REST endpoints with SDK-scoped auth.
  - Runner: Robot/agent endpoints (under runner/agent routes) for registration, job fetch, heartbeats, and result callbacks.
- **Persistence model:** Relational DB via SQLModel. Artifacts store both internal numeric IDs and public `external_id` GUIDs. Business logic uses internal IDs; public interfaces must use external GUIDs.
- **ID strategy:** Internal numeric IDs are private and only used for joins/storage. Public/API/UI/SDK/runner interactions must use `external_id` (GUID). Validation rejects numeric IDs on public surfaces.

## 4. Job Orchestration Flow
- **Manual jobs:** Created from UI/SDK against a process. Transition: PENDING → RUNNING → COMPLETED/FAILED/CANCELED. May target a robot/machine explicitly or be free for any eligible runner.
- **Triggered jobs:** Created by time or queue triggers. Triggers resolve process, parameters, and optional queue items, then enqueue jobs.
- **Queue-driven jobs:** Queue triggers or manual actions claim queue items, create jobs referencing those items, and pass payloads to runners. Queue items are updated based on job outcomes and retry policies.
- **State transitions:** Jobs emit status changes and audit events. Executions track start/end, heartbeats, and errors. Failed jobs may be retried per trigger/queue policy; terminal states are COMPLETED, FAILED, CANCELED, or STOPPED/KILLED (if supported).

## 5. Runner Interaction Model
- **Registration:** Machines generate keys; robots/agents register using machine keys and receive tokens. Host identity may be bound for trust.
- **Authentication:** Runner calls use bearer tokens or machine keys depending on route. Tokens are short-lived and scoped.
- **Job dispatch:** Pull model—runners call the orchestrator to fetch next job. Orchestrator selects eligible jobs based on status, targeting, and queue availability.
- **Heartbeats:** Runners send periodic heartbeats during execution; missing heartbeats can mark jobs stale and trigger retries or failures.
- **Failure handling:** Runner reports status and error payloads. Orchestrator updates job and linked queue items, applies retry/backoff policies, and emits notifications/audit entries.

## 6. Logs vs Traces
- **Logs:** Operational records emitted by backend, runners, and jobs. Include status changes, errors, and infrastructure events. Stored for troubleshooting and audit.
- **Execution traces:** Fine-grained step/telemetry data from automations (when provided). UI should distinguish traces (execution detail) from logs (system events). For RPA vs Agent, traces may differ in verbosity and structure; UI should label origin and type.

## 7. Multi-Tenancy & Scaling Considerations
- **Current state:** Single-tenant control plane with shared DB. No hard tenancy isolation layers yet.
- **Known limitations:** No per-tenant resource quotas, network isolation, or data-partition enforcement. Horizontal scaling requires externalizing DB/redis and running multiple backend instances behind a load balancer.
- **Design decisions:** GUID external IDs support sharding/federation later. Pull-based runners allow horizontal executor scaling. Background scheduler is single-process; for HA it must be singleton (e.g., via leader election) or moved to a dedicated worker.

## 8. API Design Philosophy
- **Why REST:** Simplicity for UI/SDK/runners; easy to proxy/cache; predictable semantics.
- **Why polling:** Runners and UI poll for jobs/status to avoid server push complexity and to work behind firewalls. WebSockets may be used for UI live updates where available, but polling is the contract.
- **Versioning strategy:** Stable base paths; backward-compatible changes preferred. New fields are additive. Breaking changes require coordinated version bumps across UI/SDK/runner.
- **Backward compatibility:** Public surfaces use external GUIDs; internal IDs are never exposed. Legacy numeric acceptance is being removed; validation rejects numeric identifiers at boundaries.

## 9. Security Model
- **Auth flows:**
  - UI: JWT-based session for users with roles/permissions.
  - SDK: Short-lived scoped tokens for development/testing; limited permissions.
  - Runner: Machine/robot tokens for job fetch, heartbeats, and result callbacks.
- **Token scopes:** Minimal necessary rights per actor (user role, SDK scope, runner job scope). Tokens are bearer and must be protected in transit.
- **Machine trust model:** Machine keys tie robots to known hosts. Regeneration invalidates old keys. Host identity may be checked to prevent key reuse.
- **Secret handling:** Assets/credentials are stored securely; secrets are masked in responses and never logged. Runners receive secrets only when executing authorized jobs.

## 10. Development & Extension Guide
- **Adding new artifacts:** Define SQLModel, migration, router, service, and UI/API client/types. Expose external_id GUIDs; keep internal IDs private.
- **Adding agent support:** Reuse runner interaction model; add agent capability flags and process types. Ensure heartbeats and job payloads capture agent-specific metadata.
- **Extending job types:** Add status enums, payload schemas, and runner-side handling. Update trigger and queue logic to understand new job intents.
- **Future roadmap hooks:**
  - Multi-tenant isolation (schema or row-level).
  - HA scheduler (leader election / distributed locks).
  - Push-based job delivery (WebSockets/long-poll) if required.
  - Structured execution traces and span correlation.

## System Architecture Summary (at a glance)
- Backend: FastAPI + SQLModel, routers per artifact, background trigger scheduler.
- Frontend: React + TypeScript + Vite consuming REST APIs.
- Runners/Agents: Pull jobs, execute packages, send heartbeats/results.
- Persistence: Relational DB with internal numeric IDs and public external GUIDs.
- Observability: Logs + audit trail; optional traces from runners.
- Security: JWT for UI, scoped tokens for SDK, machine/robot tokens for runners, RBAC enforced at routers.

#### Upload Package
```http
POST /api/packages/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <file>
name: <optional>
version: <optional>
```

#### Preflight Check
```http
POST /api/packages/preflight
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "my_package",
  "version": "1.0.0"
}
```

#### Get Entrypoint Signature
```http
GET /api/packages/{package_id}/entrypoints/{entrypoint_name}/signature
Authorization: Bearer <token>
```

#### Update Package
```http
PUT /api/packages/{package_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "is_active": true
}
```

#### Delete Package
```http
DELETE /api/packages/{package_id}
Authorization: Bearer <token>
```

### Processes API

#### List Processes
```http
GET /api/processes?search=&active_only=
Authorization: Bearer <token>
```

#### Get Process
```http
GET /api/processes/{process_id}
Authorization: Bearer <token>
```

#### Create Process
```http
POST /api/processes
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "My Process",
  "description": "Process description",
  "package_id": 1,
  "entrypoint_name": "main",
  "is_active": true
}
```

#### Update Process
```http
PUT /api/processes/{process_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "description": "Updated description",
  "is_active": false
}
```

#### Delete Process
```http
DELETE /api/processes/{process_id}
Authorization: Bearer <token>
```

### Jobs API

#### List Jobs
```http
GET /api/jobs?status=&process_id=&robot_id=
Authorization: Bearer <token>
```

#### Get Job
```http
GET /api/jobs/{job_id}
Authorization: Bearer <token>
```

#### Create Job
```http
POST /api/jobs
Authorization: Bearer <token>
Content-Type: application/json

{
  "process_id": 1,
  "parameters": {"key": "value"},
  "robot_id": null,
  "source": "MANUAL"
}
```

#### Update Job
```http
PUT /api/jobs/{job_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "completed",
  "result": {"output": "success"},
  "error_message": null
}
```

#### Cancel Job
```http
POST /api/jobs/{job_id}/cancel
Authorization: Bearer <token>
```

### Robots API

#### List Robots
```http
GET /api/robots?search=&status=
Authorization: Bearer <token>
```

#### Get Robot
```http
GET /api/robots/{robot_id}
Authorization: Bearer <token>
```

#### Create Robot
```http
POST /api/robots
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "robot-1",
  "machine_id": 1,
  "credential": {
    "username": "user",
    "password": "pass"
  }
}
```

#### Update Robot
```http
PUT /api/robots/{robot_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "offline"
}
```

#### Delete Robot
```http
DELETE /api/robots/{robot_id}
Authorization: Bearer <token>
```

#### Robot Heartbeat
```http
POST /api/robots/{robot_id}/heartbeat
Authorization: Bearer <token>
```

### Machines API

#### List Machines
```http
GET /api/machines
Authorization: Bearer <token>
```

#### Create Machine
```http
POST /api/machines
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "machine-1",
  "mode": "runner"
}
```

**Response includes `machine_key` (displayed only once)**

#### Get Machine
```http
GET /api/machines/{machine_id}
Authorization: Bearer <token>
```

#### Delete Machine
```http
DELETE /api/machines/{machine_id}
Authorization: Bearer <token>
```

### Queues API

#### List Queues
```http
GET /api/queues?search=&active_only=
Authorization: Bearer <token>
```

#### Get Queue
```http
GET /api/queues/{queue_id}
Authorization: Bearer <token>
```

#### Get Queue Stats
```http
GET /api/queues/{queue_id}/stats
Authorization: Bearer <token>
```

#### Create Queue
```http
POST /api/queues
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "work-queue",
  "description": "Main work queue",
  "max_retries": 3,
  "enforce_unique_reference": true
}
```

#### Update Queue
```http
PUT /api/queues/{queue_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "description": "Updated description",
  "max_retries": 5
}
```

#### Delete Queue
```http
DELETE /api/queues/{queue_id}
Authorization: Bearer <token>
```

### Queue Items API

#### List Queue Items
```http
GET /api/queue-items?queue_id=&status=
Authorization: Bearer <token>
```

#### Get Queue Item
```http
GET /api/queue-items/{item_id}
Authorization: Bearer <token>
```

#### Create Queue Item
```http
POST /api/queue-items
Authorization: Bearer <token>
Content-Type: application/json

{
  "queue_id": 1,
  "reference": "unique-ref-123",
  "payload": {"data": "value"},
  "priority": 0
}
```

#### Update Queue Item
```http
PUT /api/queue-items/{item_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "DONE",
  "result": {"output": "success"}
}
```

#### Delete Queue Item
```http
DELETE /api/queue-items/{item_id}
Authorization: Bearer <token>
```

### Triggers API

#### List Triggers
```http
GET /api/triggers
Authorization: Bearer <token>
```

#### Get Trigger
```http
GET /api/triggers/{trigger_id}
Authorization: Bearer <token>
```

#### Create Time Trigger
```http
POST /api/triggers
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Daily Report",
  "type": "TIME",
  "process_id": 1,
  "cron_expression": "0 9 * * *",
  "timezone": "America/New_York",
  "enabled": true
}
```

#### Create Queue Trigger
```http
POST /api/triggers
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Queue Processor",
  "type": "QUEUE",
  "process_id": 1,
  "queue_id": 1,
  "batch_size": 10,
  "polling_interval": 60,
  "enabled": true
}
```

#### Update Trigger
```http
PUT /api/triggers/{trigger_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "enabled": false
}
```

#### Enable/Disable Trigger
```http
POST /api/triggers/{trigger_id}/enable
POST /api/triggers/{trigger_id}/disable
Authorization: Bearer <token>
```

#### Delete Trigger
```http
DELETE /api/triggers/{trigger_id}
Authorization: Bearer <token>
```

### Assets API

#### List Assets
```http
GET /api/assets?search=
Authorization: Bearer <token>
```

#### Get Asset
```http
GET /api/assets/{asset_id}
Authorization: Bearer <token>
```

#### Create Asset
```http
POST /api/assets
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "api_key",
  "type": "secret",
  "value": "my-secret-value",
  "description": "API key for external service"
}
```

#### Update Asset
```http
PUT /api/assets/{asset_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "value": "new-value"
}
```

#### Delete Asset
```http
DELETE /api/assets/{asset_id}
Authorization: Bearer <token>
```

### Access Control API

#### List Roles
```http
GET /api/access/roles
Authorization: Bearer <token>
```

#### Create Role
```http
POST /api/access/roles
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Operator",
  "description": "Can manage jobs and robots",
  "permissions": [
    {
      "artifact": "jobs",
      "can_view": true,
      "can_create": true,
      "can_edit": true,
      "can_delete": false
    }
  ]
}
```

#### Update Role
```http
PUT /api/access/roles/{role_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Updated Name",
  "permissions": [...]
}
```

#### Delete Role
```http
DELETE /api/access/roles/{role_id}
Authorization: Bearer <token>
```

#### List Users
```http
GET /api/access/users
Authorization: Bearer <token>
```

#### Get User Roles
```http
GET /api/access/users/{user_id}/roles
Authorization: Bearer <token>
```

#### Assign User Roles
```http
POST /api/access/users/{user_id}/roles
Authorization: Bearer <token>
Content-Type: application/json

{
  "role_ids": [1, 2]
}
```

### Audit API

#### List Audit Events
```http
GET /api/audit?from_time=&to_time=&user=&action_type=&entity_type=&search=&page=&page_size=
Authorization: Bearer <token>
```

#### Get Audit Event
```http
GET /api/audit/{event_id}
Authorization: Bearer <token>
```

### Settings API

#### Get All Settings
```http
GET /api/settings
Authorization: Bearer <token>
```

#### Get Settings Group
```http
GET /api/settings/{group}
Authorization: Bearer <token>
```

Groups: `general`, `security`, `jobs`, `email`, `logging`

#### Update Settings Group
```http
PUT /api/settings/{group}
Authorization: Bearer <token>
Content-Type: application/json

{
  "setting_key": "value"
}
```

### Runner API (Robot-Facing)

These endpoints are used by robots to interact with the orchestrator.

#### Register Robot
```http
POST /api/runner/register-robot
Content-Type: application/json

{
  "name": "robot-1",
  "machine_key": "<machine_key>",
  "machine_signature": "<signature>",
  "machine_name": "machine-1",
  "machine_info": "Windows 10"
}
```

#### Heartbeat
```http
POST /api/runner/heartbeat
X-Robot-Token: <robot_api_token>
Content-Type: application/json

{
  "robot_id": 1,
  "machine_signature": "<signature>",
  "machine_info": "Windows 10"
}
```

#### Get Next Job
```http
POST /api/runner/next-job
X-Robot-Token: <robot_api_token>
Content-Type: application/json

{
  "robot_id": 1,
  "machine_signature": "<signature>"
}
```

#### Update Job Status
```http
POST /api/runner/jobs/{job_id}/update
X-Robot-Token: <robot_api_token>
Content-Type: application/json

{
  "status": "completed",
  "result": {"output": "success"},
  "error_message": null,
  "logs": "execution logs..."
}
```

### SDK Auth API

#### Start Session
```http
POST /api/sdk/auth/start
Content-Type: application/json

{
  "machine_name": "dev-machine"
}
```

#### Confirm Session
```http
POST /api/sdk/auth/confirm
Authorization: Bearer <user_jwt>
Content-Type: application/json

{
  "session_id": "<session_id>"
}
```

#### Poll Status
```http
GET /api/sdk/auth/status?session_id=<session_id>
```

### Dashboard API

#### Get Overview
```http
GET /api/dashboard/overview
Authorization: Bearer <token>
```

Returns:
- Summary statistics (robots, jobs, processes)
- Robot status list
- Recent jobs

## Frontend Guide

### Pages

- **Dashboard**: System overview and statistics
- **Packages**: Upload and manage automation packages
- **Processes**: Define and manage processes
- **Jobs**: View and manage job executions
- **Robots**: Monitor and manage robots
- **Machines**: Manage execution machines
- **Queues**: Manage work queues
- **Queue Items**: View and manage queue items
- **Triggers**: Configure time and queue triggers
- **Assets**: Manage configuration assets
- **Access**: Manage roles and user permissions
- **Audit**: View audit logs
- **Settings**: Configure system settings
- **SDK Auth**: Development authentication

### Navigation

The frontend uses a sidebar navigation with sections:
- **Automation**: Packages, Processes, Jobs
- **Infrastructure**: Robots, Machines
- **Work Management**: Queues, Queue Items, Triggers
- **Configuration**: Assets, Settings
- **Administration**: Access, Audit

## Usage Guide

### Workflow: Upload Package and Run Job

1. **Upload Package**:
   - Go to Packages page
   - Click "Upload Package"
   - Select `.bvpackage` file
   - Package is validated and stored

2. **Create Process**:
   - Go to Processes page
   - Click "Create Process"
   - Select the uploaded package
   - Choose an entrypoint
   - Save process

3. **Create Job**:
   - Go to Jobs page
   - Click "Create Job"
   - Select the process
   - Enter parameters (JSON)
   - Create job

4. **Robot Execution**:
   - Robot polls `/api/runner/next-job`
   - Receives job details
   - Downloads package
   - Executes automation
   - Reports result via `/api/runner/jobs/{job_id}/update`

### Workflow: Queue-Based Processing

1. **Create Queue**:
   - Go to Queues page
   - Create a queue with max retries

2. **Add Queue Items**:
   - Go to Queue Items page
   - Create items with payload data
   - Items start in `NEW` status

3. **Create Queue Trigger**:
   - Go to Triggers page
   - Create QUEUE trigger
   - Set polling interval and batch size
   - Enable trigger

4. **Automatic Processing**:
   - Scheduler polls queue
   - Creates jobs for new items
   - Jobs are picked up by robots
   - Items move to `DONE` or `FAILED`

### Workflow: Scheduled Automation

1. **Create Time Trigger**:
   - Go to Triggers page
   - Create TIME trigger
   - Set cron expression (e.g., `0 9 * * *` for daily 9 AM)
   - Set timezone
   - Enable trigger

2. **Automatic Execution**:
   - Scheduler evaluates cron expressions
   - Creates jobs at scheduled times
   - Jobs are executed by robots

### Workflow: Robot Registration

1. **Create Machine**:
   - Go to Machines page
   - Create machine in `runner` mode
   - **Copy machine_key** (shown only once)

2. **Register Robot**:
   - Use runner API to register:
   ```bash
   curl -X POST http://127.0.0.1:8000/api/runner/register-robot \
     -H "Content-Type: application/json" \
     -d '{
       "name": "robot-1",
       "machine_key": "<machine_key>",
       "machine_signature": "<signature>",
       "machine_name": "machine-1"
     }'
   ```
   - Response includes `api_token`

3. **Robot Heartbeat**:
   - Robot sends periodic heartbeats:
   ```bash
   curl -X POST http://127.0.0.1:8000/api/runner/heartbeat \
     -H "X-Robot-Token: <api_token>" \
     -H "Content-Type: application/json" \
     -d '{"robot_id": 1, "machine_signature": "<signature>"}'
   ```

## Security & Authentication

### User Authentication

- Public self-registration is disabled; admins must create invites via `POST /api/auth/invite` (requires admin JWT). Invited users finish signup at `#/invite/accept?token=...`, which calls `POST /api/auth/invite/accept`.
- Password resets use emailed links: request via `POST /api/auth/password-reset/request` (UI: `#/forgot`), then complete with `POST /api/auth/password-reset/confirm` using the token from `#/reset-password?token=...`.
- Invite tokens expire in 72 hours; password reset tokens expire in 60 minutes and are single-use and hashed server-side.
- Configure SMTP in Settings > Email (or `email.*` settings) so invite and reset emails can be delivered.

- **JWT Tokens**: 480-minute expiration
- **Password Hashing**: bcrypt
- **Default Admin**: `admin` / `admin123` (change in production!)

### Machine Authentication

- **Machine Keys**: One-time keys, hashed in database
- **Machine Signatures**: Host fingerprinting for security
- **Robot Tokens**: API tokens for robot authentication

### RBAC System

- **Artifacts**: Resources (packages, processes, jobs, etc.)
- **Permissions**: view, create, edit, delete
- **Roles**: Collections of permissions
- **Users**: Assigned one or more roles

### Secret Management

- **Secrets**: Hashed with bcrypt, never exposed
- **Credentials**: Username/password pairs, password hashed
- **API Responses**: Secrets masked as `***`

### SDK Tokens

- **Restricted Scope**: Only allowed endpoints
- **Short Lived**: 1-hour expiration
- **Development Only**: Not for production use

## Development

### Backend Development

1. **Database Reset**:
   ```bash
   # Delete database file
   rm backend/app.db
   # Restart server to recreate
   ```

2. **Run Tests**:
   ```bash
   cd backend
   pytest
   ```

3. **Code Structure**:
   - Each module has its own router
   - Models defined in `models.py`
   - Database session via dependency injection
   - Audit logging via `audit_utils.py`

### Frontend Development

1. **Development Server**:
   ```bash
   cd frontend
   npm run dev
   ```

2. **Build for Production**:
   ```bash
   npm run build
   ```

3. **TypeScript Types**:
   - Types defined in `src/types/`
   - API clients in `src/api/`

### Environment Configuration

**Backend**:
- `SECRET_KEY`: JWT secret (change in production!)
- `DATABASE_URL`: Database connection string
- CORS origins configured in `main.py`

**Frontend**:
- API base URL: Configured in API clients
- Default: `http://127.0.0.1:8000`

### Database Migrations

The system uses lightweight SQLite migrations in `db.py`. For production:
- Consider Alembic for proper migrations
- Use PostgreSQL or MySQL for scalability
- Implement proper backup strategies

## Troubleshooting

### Common Issues

1. **Database Locked**:
   - Ensure only one server instance is running
   - Check for unclosed database connections

2. **Package Upload Fails**:
   - Verify `.bvpackage` format
   - Check `bvproject.yaml` and `entry-points.json`
   - Review validation error messages

3. **Robot Not Receiving Jobs**:
   - Verify robot is online (check heartbeat)
   - Check robot's `machine_id` binding
   - Ensure jobs are in `pending` status
   - Verify robot has correct API token

4. **Trigger Not Firing**:
   - Check trigger is enabled
   - Verify cron expression syntax
   - Check timezone settings
   - Review scheduler logs

5. **Permission Denied**:
   - Verify user has required role
   - Check role permissions for artifact
   - Ensure JWT token is valid

### Logs

- **Backend**: Check console output for errors
- **Frontend**: Check browser console (F12)
- **Database**: SQLite logs in `backend/app.db`

### Reset Everything

```bash
# Stop servers
# Delete database
rm backend/app.db

# Restart backend (recreates DB)
# Login with admin/admin123
```

## License

Internal project. Add licensing terms if needed.

---

For more information, see the codebase documentation or contact the development team.
