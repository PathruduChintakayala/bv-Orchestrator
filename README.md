# BV Orchestrator

A lightweight orchestration platform built with FastAPI (backend) and React + Vite (frontend). It manages Processes, Packages, Robots (Runners), Jobs, Queues, Assets, with Audit Logs, Settings, and Role-Based Access Control (RBAC).

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
  - `#/dashboard`, `#/assets`, `#/processes`, `#/packages`, `#/robots`, `#/jobs`, `#/queues`, `#/audit`, `#/settings`
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

- Login via `/api/auth/login` with form fields `username`, `password`.
- The response includes `access_token`; supply it as `Authorization: Bearer <token>`.
- Admin user (`admin` / `admin123`) has full access by default.
- RBAC is enforced for sensitive routes (e.g., `audit:view`, `settings:view|edit`) and being expanded across all domain endpoints.

---

## Core Concepts

- Processes: Definition of automations (links to a Package and a script path).
- Packages: Zip bundles of scripts, uploaded and versioned.
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

## Admin & Operator APIs (high level)

These are authenticated with `Authorization: Bearer <token>`.

- Processes: `/api/processes` (CRUD). `script_path` should match a file in the package zip.
- Packages: `/api/packages/upload` (multipart .zip), list/get/update/delete.
- Robots: `/api/robots` (CRUD), `/api/robots/{id}/heartbeat` (operator-triggered).
- Jobs: `/api/jobs` (create/list/get/update/cancel).
- Queues/Items: `/api/queues`, `/api/queue-items` (create/update/delete).
- Assets: `/api/assets` (CRUD).
- Audit: `/api/audit` with filters `from_time`, `to_time`, `action_type`, `user`, `search`, `entity_type`.
- Settings: `/api/settings` and `/api/settings/{group}`; updates are audited.

Example: Create a job
```bash
curl -X POST http://127.0.0.1:8000/api/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "process_id": 10,
        "parameters": {"foo": "bar"}
      }'
```

Example: Upload a package
```bash
curl -X POST http://127.0.0.1:8000/api/packages/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F file=@my_package_1.0.0.zip
```

---

## Data Model (key fields)

Robot
- `id`, `name` (unique)
- `status` (online|offline)
- `last_heartbeat`
- `current_job_id`
- `machine_info`
- `api_token`
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
