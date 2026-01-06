# Queues

## Overview
- Queues collect work items (`QueueItem`) for processes and triggers.
- Items can be enqueued manually via API or runtime SDK, and consumed directly or via queue triggers that start jobs.
- Stats endpoints summarize item counts; no background cleanup or requeue logic is present.

## Purpose of queues in the platform
- Provide a FIFO/priority list of work for robots/processes to consume.
- Serve as a source for queue-based triggers that launch jobs from pending items.

## How queues are used
- Manual enqueue: Admin APIs (`POST /api/queue-items`) accept payload and optional reference/priority.
- Runtime enqueue: SDK/robot API (`POST /api/queue-items/add`) adds items by queue name.
- Consumption: Runtime API (`GET /api/queue-items/next`) locks the next `NEW` item and returns payload; triggers also consume `NEW` items.
- Job creation: Queue triggers poll queues, claim items, and create jobs referencing claimed item IDs.

## Core Concepts
- Queue: Configuration for a named work queue with retry/uniqueness settings.
- Queue Item: Individual work unit with payload, status, priority, retries, and optional reference.
- Queue Trigger: Trigger of type `QUEUE` that polls a queue and starts jobs from pending items.

## Data Model
### Queue fields
- `id` (int, PK)
- `name` (unique, indexed)
- `description` (optional)
- `max_retries` (int, default 0)
- `enforce_unique_reference` (bool, default False)
- `is_active` (bool, default True)
- `created_at`, `updated_at` (str timestamps)
- `external_id` (uuid string, unique)

### QueueItem fields
- `id` (uuid string, PK)
- `queue_id` (FK, indexed)
- `reference` (optional string, indexed)
- `status` (string, default `NEW`; allowed values in code paths: `NEW`, `IN_PROGRESS`, `DONE`, `FAILED`, `DELETED` plus any custom string accepted by update APIs)
- `priority` (int, default 0)
- `payload` (optional string/JSON)
- `result` (optional string/JSON)
- `error_message` (optional string)
- `retries` (int, default 0)
- `locked_by_robot_id` (optional int; not set by current logic)
- `locked_at` (optional str; set in stats calculations if present, but not written by current logic)
- `job_id` (optional int; set by queue triggers when creating jobs)
- `created_at`, `updated_at` (str timestamps)
- Index: `(queue_id, status)`

### Trigger fields (queue-related)
- `type` (`TIME` or `QUEUE`); queue polling uses `QUEUE`.
- `queue_id` (int, required for `QUEUE` triggers)
- `batch_size` (optional int; number of items claimed per poll)
- `polling_interval` (optional int seconds; defaults to scheduler interval when absent)
- `last_processed_item_id` (present but unused in logic)
- `last_fired_at`, `next_fire_at` (timestamps for scheduling)

## Queue Item Lifecycle
- Creation: Items start with `status` = `NEW`, `retries` = 0, timestamps set to now.
- Dequeue/runtime consumption: `GET /api/queue-items/next` finds first `NEW` item, sets status to `IN_PROGRESS`, updates `updated_at`, returns payload/reference/priority.
- Trigger consumption: Queue triggers select `NEW` items, set status to `IN_PROGRESS`, then create a job and set `job_id` on claimed items.
- Updates: `PUT /api/queue-items/{id}` and runtime status updates accept any provided `status`, `result`, `error_message`; no enforced state machine.
- Deletion: `DELETE /api/queue-items/{id}` sets status to `DELETED` (soft delete). Queue deletion hard-deletes associated items.
- Completion/Failure: Status must be set by clients or triggers; no automatic transition back to `NEW`.

## Enqueue Behavior
- Admin API `POST /api/queue-items` requires an existing queue by `queue_id`.
- Runtime API `POST /api/queue-items/add` targets a queue by `queue_name`.
- Optional `reference` accepted; if `enforce_unique_reference` is true on the queue, duplicate references are rejected (HTTP 409). A DB unique constraint is not present; enforcement is application-level per queue.
- `priority` defaults to 0; provided priority is stored as-is.
- Payloads are JSON-serialized when dict/list; otherwise stored as provided.

## Dequeue / Consumption Behavior
- Runtime `GET /api/queue-items/next`:
  - Requires queue selection via `queue_name` or `queue_id`.
  - Selects first `NEW` item ordered by `priority` DESC, then `created_at` ASC.
  - Sets status to `IN_PROGRESS`, updates `updated_at`, commits, returns id/payload/reference/priority.
  - No locking_by_robot or lease fields are set; selection is a select-then-update sequence.
- Queue triggers (scheduler):
  - Poll `NEW`/`new` items ordered by `id`, limited by `batch_size` (default 1 when unset).
  - Marks them `IN_PROGRESS`, then creates a job and assigns `job_id` to each claimed item.
  - Resets `next_fire_at` based on polling interval.
- No consumer identification is stored beyond optional `locked_by_robot_id` (unused).

## Retry & Failure Handling
- `retries` field exists but is not incremented by current APIs or triggers.
- `max_retries` on queues is read when sending failure notifications: if an item status is set to `FAILED` and `retries >= max_retries`, a notification is emitted.
- No automatic retry or requeue behavior is implemented.

## Queue Triggers
- Scheduler (`trigger_scheduler.TriggerScheduler`) polls enabled triggers every 30s (default interval) under a Redis-based lock (`trigger_scheduler_lock`).
- TIME triggers use cron expressions (not queue-related).
- QUEUE triggers:
  - Compute `next_fire_at`; poll when due.
  - Fetch `NEW`/`new` items for `queue_id` ordered by `id`, limited by `batch_size`.
  - If none, advance `next_fire_at` and continue.
  - For each claimed item: set `status` to `IN_PROGRESS`, update `updated_at`; create a job with `source="TRIGGER"` and `queue_item_ids` JSON array; set `job_id` on items; commit.
  - Notifications on trigger failure are attempted; no backoff beyond interval.

## Concurrency & Safety
- Scheduler uses Redis `set nx` lock to ensure a single scheduler tick across instances.
- Dequeue and trigger claim paths perform a SELECT followed by UPDATE/COMMIT; no explicit DB row locking or transactions around selection to prevent races.
- `locked_by_robot_id` / `locked_at` fields are not set by current logic; no visibility timeout or lease renewal.
- Multiple consumers could select the same `NEW` item in parallel before status is persisted; protection relies on status update committing first.

## Metrics & Observability
- `GET /api/queues/{id}/stats` computes counts for `NEW`, `IN_PROGRESS`, `DONE`, `FAILED` (excludes `DELETED`).
- Splits failures into `appExceptions` vs `bizExceptions` by inspecting `result` JSON (`failure_reason`/`reason`/`type`) or `error_message` containing "business".
- Computes average processing time from `locked_at` or `created_at` to `updated_at` for `DONE`/`FAILED` items. If timestamps are missing, duration is skipped.
- Logs debug stats when possible; no persisted metrics.

## Limitations & Gaps (Observed)
- `retries`, `locked_by_robot_id`, `locked_at`, and `last_processed_item_id` are present but not updated by current logic.
- No enforced status enum or state machine; updates accept arbitrary statuses.
- No DB-level uniqueness for `reference`; uniqueness is best-effort in code.
- Dequeue/claiming lacks transactional locking; potential for double-processing under concurrency.
- No visibility timeout or automatic requeue for stalled `IN_PROGRESS` items.
- `max_retries` is only used for notification thresholds; retries are never incremented automatically.
