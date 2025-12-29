
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
