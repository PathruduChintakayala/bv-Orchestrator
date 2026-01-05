# BV Orchestrator

A comprehensive Robotic Process Automation (RPA) orchestration platform that manages robots, processes, jobs, queues, triggers, and automation packages. Built with FastAPI (backend) and React (frontend), providing a complete solution for automating business processes.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Documentation](#api-documentation)
- [Frontend Guide](#frontend-guide)
- [Usage Guide](#usage-guide)
- [Security & Authentication](#security--authentication)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

## Overview

BV Orchestrator is an enterprise-grade RPA platform that enables you to:

- **Manage Automation Packages**: Upload and version control `.bvpackage` files containing automation scripts
- **Define Processes**: Create reusable process definitions that reference package entrypoints
- **Execute Jobs**: Run automation jobs on distributed robots
- **Queue Management**: Process work items through configurable queues
- **Scheduled Triggers**: Automate job execution with time-based (cron) or queue-based triggers
- **Robot Management**: Register and monitor robots that execute automation tasks
- **Access Control**: Role-based access control (RBAC) for fine-grained permissions
- **Audit Logging**: Comprehensive audit trail of all system activities
- **Asset Management**: Store and manage secrets, credentials, and configuration values

## Features

### Core Functionality

- **Package Management**
  - Upload `.bvpackage` files with validation
  - Support for multiple package versions
  - Entrypoint discovery and signature inspection
  - Package integrity verification (SHA256 hashing)
  - Preflight checks before upload

- **Process Management**
  - Define processes that reference package entrypoints
  - Support for both BV packages and legacy packages
  - Process versioning
  - Active/inactive status management

- **Job Execution**
  - Create jobs from processes
  - Job lifecycle: pending → running → completed/failed/canceled
  - Parameter passing to automation scripts
  - Result and error message capture
  - Execution logs tracking

- **Queue System**
  - Create named queues for work item processing
  - Queue items with status: NEW → IN_PROGRESS → DONE/FAILED
  - Reference-based deduplication
  - Retry mechanism with max retries
  - Batch processing support

- **Trigger System**
  - **Time Triggers**: Cron-based scheduling with timezone support
  - **Queue Triggers**: Automatic job creation when queue items are available
  - Enable/disable triggers dynamically
  - Trigger execution history

- **Robot Management**
  - Register robots via machine keys
  - Robot heartbeat monitoring
  - Online/offline status tracking
  - Machine binding and signature verification
  - Unattended execution with credential assets

- **Machine Management**
  - Create machines in `runner` or `agent` mode
  - Machine key authentication (one-time display)
  - Machine signature binding for security
  - Connection status tracking

- **Access Control (RBAC)**
  - Role-based permissions system
  - Granular permissions per artifact (view/create/edit/delete)
  - User-role assignments
  - Default roles: Administrator, Read Only

- **Audit System**
  - Comprehensive event logging
  - Filterable audit trail
  - Before/after state capture
  - User action tracking

- **Settings Management**
  - Grouped settings (general, security, jobs, email, logging)
  - Type-aware serialization (string, int, bool, json)
  - Audited changes

- **Asset Management**
  - Store text, integers, booleans
  - Secret management (hashed storage)
  - Credential storage (username/password)
  - Secure value masking in API responses

- **SDK Authentication**
  - Development-time authentication flow
  - 5-minute session windows
  - Restricted SDK token permissions

- **Dashboard**
  - Real-time system overview
  - Robot status monitoring
  - Job statistics
  - Recent job history

## Architecture

### Backend (FastAPI)

- **Framework**: FastAPI with SQLModel (SQLAlchemy)
- **Database**: SQLite (development), easily configurable for PostgreSQL/MySQL
- **Authentication**: JWT-based with bcrypt password hashing
- **API Structure**: RESTful API with `/api` prefix

### Frontend (React)

- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite
- **Routing**: Client-side routing
- **API Integration**: TypeScript API clients

### Key Components

```
backend/
├── main.py              # FastAPI app entry point
├── models.py            # SQLModel data models
├── db.py                # Database initialization
├── auth.py              # Authentication & JWT
├── packages.py          # Package management
├── processes.py         # Process definitions
├── jobs.py              # Job execution
├── robots.py            # Robot management
├── machines.py          # Machine management
├── queues.py            # Queue management
├── queue_items.py       # Queue item processing
├── triggers.py          # Trigger definitions
├── trigger_scheduler.py # Background scheduler
├── assets.py            # Asset management
├── access.py            # RBAC system
├── audit.py             # Audit logging
├── settings.py          # Settings management
├── runner.py            # Robot-facing API
├── sdk_auth.py          # SDK authentication
└── dashboard.py         # Dashboard metrics

frontend/
├── src/
│   ├── pages/           # React page components
│   ├── components/      # Reusable components
│   ├── api/             # API client functions
│   └── types/           # TypeScript type definitions
```

## Installation

### Prerequisites

- Python 3.9+
- Node.js 18+
- npm or yarn

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Create a virtual environment (recommended):
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Initialize the database:
```bash
# The database is automatically created on first run
python -m uvicorn main:app --reload
```

The backend will:
- Create `app.db` SQLite database
- Initialize all tables
- Create default admin user (username: `admin`, password: `admin123`)
- Create default roles (Administrator, Read Only)

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The frontend will run on `http://localhost:5173` (Vite default port).

## Quick Start

1. **Start Backend**:
```bash
cd backend
python -m uvicorn main:app --reload
```
Backend runs on `http://127.0.0.1:8000`

2. **Start Frontend**:
```bash
cd frontend
npm run dev
```
Frontend runs on `http://localhost:5173`

3. **Login**:
   - Open `http://localhost:5173`
   - Username: `admin`
   - Password: `admin123`

4. **Upload a Package**:
   - Navigate to Packages page
   - Click "Upload Package"
   - Select a `.bvpackage` file
   - Package is validated and stored

5. **Create a Process**:
   - Navigate to Processes page
   - Click "Create Process"
   - Select a package and entrypoint
   - Save the process

6. **Create a Job**:
   - Navigate to Jobs page
   - Click "Create Job"
   - Select a process
   - Provide parameters (JSON)
   - Job is created in `pending` status

7. **Register a Robot**:
   - Create a Machine in Machines page
   - Copy the `machine_key` (shown only once)
   - Use the runner API to register a robot
   - Robot will appear in Robots page

## Core Concepts

### Packages

A **package** is a `.bvpackage` file containing automation code. Packages must include:
- `bvproject.yaml`: Package metadata (name, version)
- `entry-points.json`: Entrypoint definitions
- `main.py` or other Python files with automation functions

**Package Structure**:
```
my_package_1.0.0.bvpackage
├── bvproject.yaml
├── entry-points.json
├── main.py
├── requirements.lock
└── manifest.json
```

### Processes

A **process** defines how to execute a package entrypoint. It links:
- A package (by ID)
- An entrypoint name (for BV packages)
- Optional description and metadata

Processes can be active or inactive. Only active processes can be used to create jobs.

### Jobs

A **job** is a single execution instance of a process. Jobs have:
- **Status**: `pending` → `running` → `completed`/`failed`/`canceled`
- **Parameters**: JSON data passed to the automation script
- **Result**: JSON data returned from execution
- **Error Message**: Error details if execution fails
- **Execution ID**: Unique UUID for tracking

### Robots

A **robot** is an execution agent that:
- Registers with a machine key
- Polls for pending jobs
- Executes jobs and reports results
- Sends heartbeats to maintain online status

Robots can be:
- **Online**: Actively processing jobs
- **Offline**: Not responding to heartbeats

### Machines

A **machine** represents a physical or virtual machine where robots run. Machines have:
- **Mode**: `runner` (executes jobs) or `agent` (monitoring)
- **Status**: `connected` or `disconnected`
- **Machine Key**: One-time authentication key (hashed in DB)
- **Signature Hash**: Machine fingerprint for security

### Queues

A **queue** is a container for work items. Queues support:
- **Max Retries**: Maximum retry attempts for failed items
- **Unique References**: Prevent duplicate items by reference
- **Active Status**: Enable/disable queue processing

### Queue Items

A **queue item** represents a unit of work. Items have:
- **Status**: `NEW` → `IN_PROGRESS` → `DONE`/`FAILED`
- **Reference**: Optional unique identifier
- **Payload**: JSON data for processing
- **Priority**: Integer for ordering (higher = first)
- **Retries**: Current retry count

### Triggers

A **trigger** automatically creates jobs based on:
- **Time Triggers**: Cron expressions (e.g., `0 9 * * *` for daily at 9 AM)
- **Queue Triggers**: Polls a queue and creates jobs for new items

Triggers can be enabled/disabled without deletion.

### Assets

**Assets** store configuration values:
- **Text**: Plain text values
- **Int**: Integer values
- **Bool**: Boolean values
- **Secret**: Hashed secrets (never exposed)
- **Credential**: Username/password pairs (hashed)

### Roles & Permissions

**Roles** define permission sets:
- **Artifacts**: Resources (packages, processes, jobs, robots, etc.)
- **Permissions**: view, create, edit, delete

**Users** are assigned roles, inheriting all permissions from their roles.

## API Documentation

### Authentication

Most endpoints require JWT authentication:

```bash
# Login
curl -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=admin123"

# Response: {"access_token": "...", "token_type": "bearer"}

# Use token in requests
curl -X GET http://127.0.0.1:8000/api/packages \
  -H "Authorization: Bearer <token>"
```

### Packages API

#### List Packages
```http
GET /api/packages?search=&active_only=&name=
Authorization: Bearer <token>
```

#### Get Package
```http
GET /api/packages/{package_id}
Authorization: Bearer <token>
```

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
