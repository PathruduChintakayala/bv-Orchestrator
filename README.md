# BV Orchestrator

A lightweight orchestration platform built with FastAPI (backend) and React + Vite (frontend). It manages Processes, Packages, Machines, Robots (Runners), Jobs, Queues, Assets, with Audit Logs, Settings, and Role-Based Access Control (RBAC).

- Backend: FastAPI + SQLModel + SQLite (dev)
- Frontend: React + TypeScript + Vite
- Runner-facing APIs: Robot register/heartbeat, next-job, job result update, and package download

---

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+ and npm
- Windows PowerShell (or any shell)

### Backend (FastAPI)
```powershell
# From repo root
python -m venv .venv
. .venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt

# Run the API on http://127.0.0.1:8000
uvicorn backend.main:app --reload
```

Notes:
- On first start, the database is created at `backend/app.db`.
- A default admin user is seeded: username `admin`, password `admin123`.
- CORS allows Vite dev server: http://localhost:5173.

### Frontend (Vite + React)
```powershell
# From repo root
cd frontend
npm install
npm run dev
```
- Opens on http://localhost:5173
- The frontend proxies `/api/*` to the backend

Tip:
- The VS Code task “Start Frontend Dev Server” runs `npm run dev` with `frontend/` as the working directory.

---

## Frontend

### Overview
- Framework: React + TypeScript (Vite dev server)
- Routing: Hash-based (uses `window.location.hash`) for simple static hosting
- Auth: JWT stored in `localStorage` as `token`; API clients send `Authorization: Bearer <token>`
- UI Shell: Two-row fixed header with horizontal navigation and a user menu
- Styling: Utility inline styles and small CSS files (no heavy UI framework)

### Directory Structure
```
frontend/
  src/
    api/           # API clients (fetch + auth header)
    components/    # Layout and shared components
    pages/         # Route pages (Dashboard, Jobs, etc.)
    types/         # Shared TypeScript types
    App.tsx        # App wrapper
    main.tsx       # Router and bootstrapping
```

Key files:
- App shell: [frontend/src/components/AppLayout.tsx](frontend/src/components/AppLayout.tsx)
- Routes: [frontend/src/main.tsx](frontend/src/main.tsx)
- Audit page: [frontend/src/pages/AuditPage.tsx](frontend/src/pages/AuditPage.tsx)
- Audit client/types: [frontend/src/api/audit.ts](frontend/src/api/audit.ts), [frontend/src/types/audit.ts](frontend/src/types/audit.ts)

### Running & Building
```powershell
# Dev server (hot reload)
cd frontend
npm run dev

# Type-check & lint (if configured)
npm run build -- --emptyOutDir

# Preview the production build
npm run preview
```

### Routing & Navigation
- Hash routes (examples):
  - `#/dashboard`, `#/assets`, `#/processes`, `#/packages`, `#/machines`, `#/robots`, `#/jobs`, `#/queues`, `#/audit`, `#/settings`
  - `#/sdk-auth?session_id=<uuid>` (developer-only SDK authentication)
- Header highlights the active tab based on `location.hash`.
- Simple guarded links for Audit/Settings using a lightweight `hasPermission` helper in the app header (admin passes; otherwise reads a permissions map from localStorage).

### Authentication
- On successful login, the JWT is saved to `localStorage.token`.
- API clients read `localStorage.token` and attach `Authorization` header.
- Minimal UI gating reads:
  - `localStorage.currentUser` (JSON with `is_admin` flag) when present
  - `localStorage.permissions` (map: `artifact:op` → true)
- Note: Backed by server-side RBAC checks to enforce security; the client-side check only hides UI affordances.

### API Clients
- Located under [frontend/src/api](frontend/src/api)
- Shared patterns:
  - Attach `Authorization` from `localStorage.token` when calling `/api/*`
  - Map snake_case backend fields to camelCase in the UI layer
  - Parse JSON-encoded fields safely (e.g., job parameters, audit details)

### Audit UI
- Filters: search, from/to (datetime), Action Type (dropdown), Entity Type (dropdown), User (text)
- Columns: Time (formatted), User, Action (friendly label), Entity (display), Details (message/summary)
- Row click opens a modal with Before/After/Metadata (when present)
- Uses normalized fields returned by backend (`action_type`, `entity_display`, `message`)

### Pages (high level)
- Dashboard: System overview and quick links
- Assets / Processes / Packages / Robots / Jobs / Queues: CRUD and activity views
- Audit: Event list with filters and details modal
- Settings: Grouped settings (read/update); changes are audited
- Manage Access: Roles, permissions, and user-to-role assignments
- Auth: Login, Register, Forgot Password, Logged Out

### Configuration & Proxy
- The frontend uses relative `/api/*` paths; Vite dev server proxies to the backend.
- If you host frontend and backend separately, configure reverse proxy rules or set a base URL in your API layer.

### Common Workflows
1) Sign in as admin (`admin` / `admin123`).
2) Upload a package zip under Packages → Upload.
3) Create a Process and select the package + `script_path` from the zip.
4) Create a Job for that Process (optionally set parameters).
5) Run your runner agent to pick the job; observe Job status and Audit logs.
6) Use Audit filters to search by action, entity, and time window.

### Roadmap (Frontend)
- Consistent filter bars across list pages (Jobs, Robots, Queues, Assets)
- Deep linking between entities (e.g., Job → Process; Queue Item → Queue)
- Job Details page with live logs and result inspection
- Replace placeholder Settings UI with structured editors and validation
- Replace local permissions placeholders with `/auth/me` payload


## Authentication & RBAC

- RBAC is enforced server-side via artifacts in `backend/permissions.py` (see `ARTIFACTS`).


## Core Concepts

- Processes: Definition of automations (links to a Package and a script path).
- Packages: Zip bundles of scripts, uploaded and versioned.
- Machines: Logical compute targets for robots.
- Robots: Runner agents that execute jobs; authenticate with `X-Robot-Token`.
- Jobs: Executions of a Process, tracked from pending → running → completed/failed/canceled.
- Queues & Items: Optional work queues with retries and locking.
- Assets: Key/value configuration and secrets.
- Audit Logs: Records key actions and changes.
- Settings: System settings, grouped (general, security, jobs, email, logging).

---

## Runner-Facing APIs

Headers for runner endpoints: `X-Robot-Token: <api_token>` where required.

### 1) Register Robot
POST `/api/runner/register-robot`

Request:
```json
{
  "name": "Robot-01",
  "machine_info": "HOST (OS ...)"
}
```
Response:
```json
{ "robot_id": 1, "api_token": "<token>", "name": "Robot-01" }
```
- Creates or reuses a Robot (by `name`), ensures an `api_token` exists.
- Sets status to `online`, updates `last_heartbeat`.

### 2) Heartbeat
POST `/api/runner/heartbeat`

Headers: `X-Robot-Token`

Request:
```json
{ "robot_id": 1, "machine_info": "HOST (OS ...)" }
```
Response:
```json
{ "status": "ok" }
```
- Updates `last_heartbeat`, `status = online`, and `machine_info`.

### 3) Next Job
POST `/api/runner/next-job`

Headers: `X-Robot-Token`

Request:
```json
{ "robot_id": 1 }
```
Response (example):
```json
{
  "job": {
    "id": 123,
    "status": "running",
    "parameters": { "foo": "bar" },
    "process": { "id": 10, "name": "Proc A", "script_path": "main.py", "package_id": 7 },
    "package": { "id": 7, "name": "pkg-a", "version": "1.2.3" }
  }
}
```
- In a single transaction: picks the oldest `pending` job (assigned to the robot or unassigned), marks it `running`, sets `started_at`, and updates `robot.current_job_id`.
- If no job: `{ "job": null }`.

### 4) Update Job Result
POST `/api/runner/jobs/{job_id}/update`

Headers: `X-Robot-Token`

Request:
```json
{
  "status": "completed",
  "result": { "return_code": 0 },
  "error_message": null,
  "logs": "last N lines here"
}
```
Response:
```json
{ "status": "ok" }
```
- Allowed statuses: `completed` or `failed`.
- Validates job belongs to the robot and is in `running|pending`.
- Updates `finished_at`, persists `result`/`error_message` (stores logs under result), clears robot `current_job_id`.

### 5) Download Package
GET `/api/packages/{package_id}/download`

Headers: `X-Robot-Token`

- Returns the package zip file for the runner to extract.

---

## SDK Development Authentication (Developer-Only)

This is a developer-only authentication flow for local SDK/CLI usage.

Goal:
- SDK opens the frontend in a browser
- Developer logs in interactively
- Backend issues a short-lived SDK JWT
- SDK polls backend and receives the token

Important guardrails:
- Not runner auth
- No refresh tokens
- Session auto-expires (5 minutes)
- Session is single-use (once a token is minted, the session is expired)
- SDK JWT is never stored in the frontend

### Flow

1) SDK starts a session (no auth): `POST /api/sdk/auth/start`
2) SDK opens the browser to: `http://localhost:5173/#/sdk-auth?session_id=<uuid>`
3) If the user is not logged in, the page redirects to `#/login` and returns to the original `#/sdk-auth?session_id=...` after login
4) Frontend confirms the session (user JWT): `POST /api/sdk/auth/confirm`
5) SDK polls: `GET /api/sdk/auth/status?session_id=<uuid>` until confirmed

Frontend return behavior (important):
- The frontend uses `sessionStorage` as the *only* return mechanism.
- Key: `bv_return_to`.
- When an unauthenticated user lands on `#/sdk-auth?session_id=...`, the app stores `window.location.hash` into `sessionStorage.bv_return_to` (only if not already set, and never stores `#/login`) and then navigates to `#/login`.
- After successful login, the app consumes `sessionStorage.bv_return_to` exactly once and navigates back to it.
- No `returnTo` query parameters are used (prevents nested redirects and losing `session_id`).

Auto-close note:
- After a successful confirmation, the SDK auth page attempts to close the tab as a best-effort.
- Some browsers block `window.close()` unless the tab was opened by script; in that case the page will remain open and show the success message.

### Endpoints (`/api/sdk/auth`)

- `POST /api/sdk/auth/start`
  - Request: `{ "machine_name": "DEV-HOST-01" }`
  - Response: `{ "session_id": "uuid", "expires_at": "ISO8601" }`
  - Rules: one active (unexpired) session per machine is reused

- `POST /api/sdk/auth/confirm`
  - Headers: `Authorization: Bearer <user-jwt>`
  - Request: `{ "session_id": "uuid" }`
  - Behavior: validates not expired; confirms session (idempotent)

- `GET /api/sdk/auth/status?session_id=uuid`
  - Pending: `{ "status": "pending" }`
  - Confirmed: `{ "status": "confirmed", "access_token": "<sdk-jwt>", "expires_at": "ISO8601", "user": { "id": 1, "username": "admin" } }`
  - Expired/unknown: `{ "status": "expired" }`

### SDK JWT Scope Rules

SDK JWTs include claim: `auth_type: "sdk"` and are restricted server-side to:

Allowed:
- `GET /api/assets`
- `GET /api/queues`
- `POST /api/queue-items`

Denied:
- Robots
- Jobs
- Runner APIs
- Package upload

Note: The SDK token uses the same JWT format as normal login tokens, but is short-lived and restricted by middleware.

## Admin & Operator APIs (high level)

These are authenticated with `Authorization: Bearer <token>`.


### Base URLs

- Backend dev server: `http://127.0.0.1:8000`
- API prefix: `/api`
- OpenAPI/Swagger UI: `/docs`

### Authentication summary

- **User/API auth**: `Authorization: Bearer <access_token>`
  - Obtain token with `POST /api/auth/login`.
  - Most operator/admin endpoints also enforce RBAC permissions via `require_permission(artifact, operation)`.
- **Runner/Robot auth**: `X-Robot-Token: <api_token>`
  - Obtain token with `POST /api/runner/register-robot`.
  - Used for runner endpoints and package download.

### Endpoints (implemented)

#### Root

- `GET /` — simple root response (`{"message": "Hello FastAPI!"}`)

#### Auth (`/api/auth`)

- `POST /api/auth/login` — login (OAuth2 password form: `username`, `password`) → `{ access_token, token_type }`
- `POST /api/auth/register` — register a user (JSON payload)
- `POST /api/auth/forgot` — reset password (JSON: `username`, `email`, `newPassword`)
- `GET /api/auth/me` — returns current user + roles + permissions map

#### Dashboard (`/api/dashboard`)

- `GET /api/dashboard/overview` — dashboard summary, robot list, recent jobs

#### Assets (`/api/assets`) — RBAC artifact: `assets`

- `GET /api/assets?search=` — list assets
- `GET /api/assets/{asset_id}` — get asset
- `POST /api/assets` — create asset
- `PUT /api/assets/{asset_id}` — update asset
- `DELETE /api/assets/{asset_id}` — delete asset

Notes:
- Asset `type` supports (canonical): `text`, `int`, `boolean`, `secret`, `credential`.
- Secret/Credential values are stored hashed and are masked (`"***"`) on read.

Note:
- The backend normalizes common legacy casing (e.g., `Text`) to canonical lowercase.

#### Processes (`/api/processes`) — RBAC artifact: `processes`

- `GET /api/processes?search=&active_only=` — list processes
- `GET /api/processes/{process_id}` — get process
- `POST /api/processes` — create process
- `PUT /api/processes/{process_id}` — update process (increments `version` when definition changes)
- `DELETE /api/processes/{process_id}` — delete process

Notes:
- `script_path` should point to a `.py` file path within the uploaded package zip.

#### Packages (`/api/packages`) — RBAC artifact: `packages`

- `POST /api/packages/upload` — upload package zip (multipart form)
  - File must be `.zip`.
  - Filename convention supported: `name_version.zip` where version is `X.X.X`.
- `GET /api/packages?search=&active_only=&name=` — list packages
- `GET /api/packages/{pkg_id}` — get package
- `PUT /api/packages/{pkg_id}` — update package (name/version/active)
- `DELETE /api/packages/{pkg_id}` — delete package (best-effort deletes zip from disk)

Runner download:

- `GET /api/packages/{package_id}/download` — download package zip (**requires** `X-Robot-Token`)

#### Machines (`/api/machines`) — RBAC artifact: `machines`

- `GET /api/machines` — list machines
- `POST /api/machines` — create machine
- `GET /api/machines/{machine_id}` — get machine
- `DELETE /api/machines/{machine_id}` — delete machine (blocked if robots exist)

Notes:
- `POST /api/machines` returns `machine_key` only on creation (one-time display) for `runner` mode.
- The server stores only a hash of the machine key; it cannot be retrieved later.

#### Robots (operator/admin) (`/api/robots`) — RBAC artifact: `robots`

- `GET /api/robots?search=&status=` — list robots
- `GET /api/robots/{robot_id}` — get robot
- `POST /api/robots` — create robot (generates `api_token`)
- `PUT /api/robots/{robot_id}` — update robot
- `DELETE /api/robots/{robot_id}` — delete robot
- `POST /api/robots/{robot_id}/heartbeat` — operator-triggered heartbeat (sets robot online)

Notes:
- Robots can be linked to a machine via `machine_id`.
- Robot creation supports optional unattended credentials via `credential: { username, password }`.

#### Jobs (`/api/jobs`) — RBAC artifact: `jobs`

- `GET /api/jobs?status=&process_id=&robot_id=` — list jobs
- `GET /api/jobs/{job_id}` — get job
- `POST /api/jobs` — create job (creates `pending` job)
- `PUT /api/jobs/{job_id}` — update job (status/assignment/result/error)
- `POST /api/jobs/{job_id}/cancel` — cancel job (pending/running → canceled)

#### Queues (`/api/queues`) — RBAC artifact: `queues`

- `GET /api/queues?search=&active_only=` — list queues
- `GET /api/queues/{queue_id}` — get queue
- `POST /api/queues` — create queue
- `PUT /api/queues/{queue_id}` — update queue
- `DELETE /api/queues/{queue_id}` — delete queue

#### Queue Items (`/api/queue-items`) — RBAC artifact: `queue_items`

- `GET /api/queue-items?queue_id=&status=` — list queue items
- `GET /api/queue-items/{item_id}` — get queue item
- `POST /api/queue-items` — create queue item
- `PUT /api/queue-items/{item_id}` — update queue item
- `DELETE /api/queue-items/{item_id}` — delete queue item

#### Access / RBAC Management (`/api/access`)

Roles (RBAC artifact: `roles`):

- `GET /api/access/roles` — list roles (+ permissions)
- `GET /api/access/roles/{role_id}` — get role
- `POST /api/access/roles` — create role (with permissions)
- `PUT /api/access/roles/{role_id}` — update role (optionally replace permissions)
- `DELETE /api/access/roles/{role_id}` — delete role

Users (RBAC artifact: `users`):

- `GET /api/access/users` — list users
- `GET /api/access/users/{user_id}/roles` — get roles for user
- `POST /api/access/users/{user_id}/roles` — assign roles to user (`role_ids`)

#### Audit (`/api/audit`) — RBAC artifact: `audit`

- `GET /api/audit` — list audit events with filters
  - Time: `from_time`, `to_time` (also supports legacy `from`, `to`)
  - Actor: `user`, `username`, `user_id`
  - Action: `action` or `action_type` (`created|modified|deleted|status_changed|login|logout`)
  - Entity: `entity_type`, `entity_id`
  - Search: `search` (also supports legacy `q`)
  - Paging: `page`, `page_size`
- `GET /api/audit/{event_id}` — get audit event details (before/after/metadata)

#### Settings (`/api/settings`) — RBAC artifact: `settings`

- `GET /api/settings` — get all settings groups
- `GET /api/settings/{group}` — get a settings group
- `PUT /api/settings/{group}` — update a settings group (audited)

Allowed groups: `general`, `security`, `jobs`, `email`, `logging`.

#### Runner / Robot-Facing (`/api/runner`)

- `POST /api/runner/register-robot` — register/get robot token by name
- `POST /api/runner/heartbeat` — runner heartbeat (**requires** `X-Robot-Token`)
- `POST /api/runner/next-job` — claim next job (**requires** `X-Robot-Token`)
- `POST /api/runner/jobs/{job_id}/update` — set job `completed|failed` (**requires** `X-Robot-Token`)

#### SDK Development Auth (`/api/sdk/auth`)

- `POST /api/sdk/auth/start` — start/reuse a 5-minute session (no auth)
- `POST /api/sdk/auth/confirm` — confirm session (requires `Authorization: Bearer <user-jwt>`)
- `GET /api/sdk/auth/status?session_id=...` — poll status (returns `pending|confirmed|expired`)

### Example: Create a job

```bash
curl -X POST http://127.0.0.1:8000/api/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "process_id": 10,
        "parameters": {"foo": "bar"}
      }'
```

### Example: Upload a package

```bash
curl -X POST http://127.0.0.1:8000/api/packages/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F file=@my_package_1.0.0.zip
```

---

## Data Model (key fields)

Machine
- `id`, `name` (unique)
- `mode` (`runner|agent`)
- `status` (`connected|disconnected`)
- `last_seen_at`
- `created_at`, `updated_at`

Robot
- `id`, `name` (unique)
- `status` (online|offline)
- `last_heartbeat`
- `current_job_id`
- `machine_info`
- `machine_id` (optional link to Machine)
- `api_token`
- `credential_asset_id` (optional link to a Credential Asset)
- `created_at`, `updated_at`

Job
- `id`, `process_id`, `package_id`, `robot_id`
- `status` (pending|running|completed|failed|canceled)
- `parameters`, `result`, `error_message`, `logs_path`
- `created_at`, `started_at`, `finished_at`

Package
- `id`, `name`, `version`, `file_path`, `scripts_manifest`, `is_active`
- `created_at`, `updated_at`

Process
- `id`, `name`, `package_id`, `script_path`, `version`, `is_active`
- `created_at`, `updated_at`

---

## Job Lifecycle (current)

- Create → `pending`
- Runner picks → `running` (sets `started_at`)
- Runner completes → `completed` or `failed` (sets `finished_at`)
- Manual cancel endpoint → `canceled`

Roadmap includes stricter state transition enforcement and idempotent updates.

---

## Audit Logging

- Emitted on key events: create/update/delete for assets/processes/packages/robots/jobs, settings update, role changes, job status changes.
- API: `/api/audit` supports filters (`from_time`, `to_time`, `action_type`, `user`, `entity_type`, `search`).
- Frontend Audit page provides filters and details modal.

---

## Settings

- Groups: `general`, `security`, `jobs`, `email`, `logging`.
- Get all: `GET /api/settings`
- Get group: `GET /api/settings/{group}`
- Update group: `PUT /api/settings/{group}` (audited; type-aware serialization for bool/int/json/string)

---

## Development Tips

- Reset DB (dev only): stop the server and delete `backend/app.db`.
  - If you pulled schema changes (e.g., Machines / Robot `machine_id`), an existing dev DB may need a reset.
- Backend secret key (`backend/auth.py`) is for dev only; rotate for production.
- File storage for packages: `backend/packages_store/` (created automatically).

---

## Roadmap (Suggested Enhancements)

1) RBAC enforcement across all domain endpoints (`assets`, `processes`, `packages`, `jobs`, `robots`, `queues`, `queue_items`, `users`, `roles`).
2) Job and queue lifecycle hardening: allowed transitions, idempotency, watchdogs for timeouts and stale locks.
3) Concurrency/locking: transactional claim for next-job/queue-item; consistency of `current_job_id`.
4) Logging & observability: job logs UI, metrics (daily counts, robot online/offline), health endpoints.
5) Versioning semantics: persist process/package versions on job creation; UI display (Process vX, Package vY.Z).
6) Asset/secret management: encrypt retrievable secrets, mask consistently, scope by process/system.
7) Settings wiring: backend behavior driven by settings (password policy, retries/timeouts, retention); cache settings.
8) UI/UX tightening: cross-linking between entities, consistent filters; quick actions on Dashboard.
9) External surface: public API contracts, service accounts/API tokens, webhooks for job/queue events, rate limiting.
10) Testing & migrations: integration tests for critical flows; introduce Alembic migrations.

---

## License

Internal project. Add licensing terms if needed.
