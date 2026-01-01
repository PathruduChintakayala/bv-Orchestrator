from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import JSONResponse
from sqlmodel import select
from jose import jwt

from sqlmodel import Session

from backend.db import engine, init_db
from backend.auth import router as auth_router, ensure_admin_user
from backend.dashboard import router as dashboard_router
from backend.assets import router as assets_router
from backend.processes import router as processes_router
from backend.packages import router as packages_router
from backend.robots import router as robots_router
from backend.machines import router as machines_router
from backend.jobs import router as jobs_router
from backend.queues import router as queues_router
from backend.queue_items import router as queue_items_router
from backend.triggers import router as triggers_router
from backend.access import router as access_router
from backend.access import ensure_default_roles
from backend.audit import router as audit_router
from backend.settings import router as settings_router
from backend.runner import router as runner_router
from backend.sdk_auth import router as sdk_auth_router
from backend.job_execution_logs import router as job_execution_logs_router
from backend.logs import router as logs_router
from backend.trigger_scheduler import scheduler
from backend.models import User
from backend.auth import SECRET_KEY, ALGORITHM

app = FastAPI()

# Adjust origins as needed (use specific domains in real projects)
origins = [
    "http://localhost:5173",  # Vite default dev port
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def sdk_token_guard(request, call_next):
    """Restrict SDK development tokens to a very small surface area.

    This is intentionally *not* runner auth; it only applies when the JWT has claim:
      auth_type = "sdk"
    """
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1].strip()
        if token:
            try:
                payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            except Exception:
                payload = None
            if payload and payload.get("auth_type") == "sdk":
                method = request.method.upper()
                path = request.url.path
                allowed = (
                    (method == "GET" and (path == "/api/assets" or path.startswith("/api/assets/")))
                    or (method == "GET" and (path == "/api/queues" or path.startswith("/api/queues/")))
                    or (method == "POST" and path == "/api/queue-items")
                    or (method == "POST" and path == "/api/packages/preflight")
                    or (method == "POST" and path == "/api/packages/upload")
                )
                if not allowed:
                    return JSONResponse(
                        status_code=403,
                        content={"detail": "SDK token not permitted for this endpoint"},
                    )
    return await call_next(request)


@app.get("/")
def read_root():
    return {"message": "Hello FastAPI!"}

# Initialize DB and seed admin at startup
@app.on_event("startup")
def on_startup():
    init_db()
    with Session(engine) as session:
        ensure_admin_user(session)
        ensure_default_roles(session)
    scheduler.start()


@app.on_event("shutdown")
async def on_shutdown():
    await scheduler.stop()

# Auth routes (under /api for consistency)
app.include_router(auth_router, prefix="/api")
app.include_router(dashboard_router, prefix="/api")
app.include_router(assets_router, prefix="/api")
app.include_router(processes_router, prefix="/api")
app.include_router(packages_router, prefix="/api")
app.include_router(robots_router, prefix="/api")
app.include_router(machines_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")
app.include_router(queues_router, prefix="/api")
app.include_router(queue_items_router, prefix="/api")
app.include_router(triggers_router, prefix="/api")
app.include_router(access_router, prefix="/api")
app.include_router(audit_router, prefix="/api")
app.include_router(settings_router, prefix="/api")
app.include_router(runner_router, prefix="/api")
app.include_router(sdk_auth_router, prefix="/api")
app.include_router(job_execution_logs_router, prefix="/api")
app.include_router(logs_router, prefix="/api")
