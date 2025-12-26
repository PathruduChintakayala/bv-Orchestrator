from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import select

from .db import init_db, get_session
from .auth import router as auth_router, ensure_admin_user
from .dashboard import router as dashboard_router
from .assets import router as assets_router
from .processes import router as processes_router
from .packages import router as packages_router
from .robots import router as robots_router
from .jobs import router as jobs_router
from .queues import router as queues_router
from .queue_items import router as queue_items_router
from .access import router as access_router
from .access import ensure_default_roles
from .audit import router as audit_router
from .settings import router as settings_router
from .runner import router as runner_router
from .models import User

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


@app.get("/")
def read_root():
    return {"message": "Hello FastAPI!"}

# Initialize DB and seed admin at startup
@app.on_event("startup")
def on_startup():
    init_db()
    session = get_session()
    try:
        ensure_admin_user(session)
        ensure_default_roles(session)
    finally:
        session.close()

# Auth routes (under /api for consistency)
app.include_router(auth_router, prefix="/api")
app.include_router(dashboard_router, prefix="/api")
app.include_router(assets_router, prefix="/api")
app.include_router(processes_router, prefix="/api")
app.include_router(packages_router, prefix="/api")
app.include_router(robots_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")
app.include_router(queues_router, prefix="/api")
app.include_router(queue_items_router, prefix="/api")
app.include_router(access_router, prefix="/api")
app.include_router(audit_router, prefix="/api")
app.include_router(settings_router, prefix="/api")
app.include_router(runner_router, prefix="/api")
