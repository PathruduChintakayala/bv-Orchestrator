import json
import zipfile
import os
from typing import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from backend.auth import get_current_user
from backend.db import get_session
from backend.models import User
from backend.packages import router as packages_router
from backend.processes import router as processes_router
from backend.jobs import router as jobs_router
import backend.permissions as permissions
import backend.packages as packages_mod


@pytest.fixture()
def engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


@pytest.fixture()
def session(engine) -> Generator[Session, None, None]:
    with Session(engine) as s:
        yield s


@pytest.fixture()
def app(session, monkeypatch, tmp_path) -> FastAPI:
    # Store uploaded artifacts in a temp directory for isolation.
    monkeypatch.setattr(packages_mod, "PACKAGE_DIR", str(tmp_path / "packages_store"))
    os.makedirs(packages_mod.PACKAGE_DIR, exist_ok=True)

    # Permission checks are not under test here.
    monkeypatch.setattr(permissions, "has_permission", lambda *args, **kwargs: True)

    app = FastAPI()
    app.include_router(packages_router, prefix="/api")
    app.include_router(processes_router, prefix="/api")
    app.include_router(jobs_router, prefix="/api")

    def _get_session_override():
        yield session

    def _get_current_user_override():
        return User(id=1, username="test", password_hash="x", is_admin=True)

    app.dependency_overrides[get_session] = _get_session_override
    app.dependency_overrides[get_current_user] = _get_current_user_override
    return app


@pytest.fixture()
def client(app: FastAPI) -> Generator[TestClient, None, None]:
    with TestClient(app) as c:
        yield c


def make_bvpackage_bytes(
    *,
    name: str = "demo",
    version: str = "1.2.3",
    entrypoints=None,
) -> bytes:
    if entrypoints is None:
        entrypoints = [
            {"name": "main", "command": "demo.main:run", "default": True},
            {"name": "other", "command": "demo.other:run", "default": False},
        ]

    bvproject_yaml = (
        "name: " + name + "\n"
        "version: \"" + version + "\"\n"
        "entrypoints:\n"
        + "".join(
            [
                "  - name: " + ep["name"] + "\n"
                "    command: " + ep["command"] + "\n"
                "    default: " + ("true" if ep.get("default") else "false") + "\n"
                for ep in entrypoints
            ]
        )
    )

    entry_points_json = json.dumps(entrypoints)

    import io

    stream = io.BytesIO()
    with zipfile.ZipFile(stream, mode="w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("bvproject.yaml", bvproject_yaml)
        z.writestr("entry-points.json", entry_points_json)
        z.writestr("pyproject.toml", "[project]\nname = 'demo'\n")
        z.writestr("demo/__init__.py", "")
        z.writestr("demo/main.py", "def run():\n    return 0\n")
    return stream.getvalue()


def make_legacy_zip_bytes() -> bytes:
    import io

    stream = io.BytesIO()
    with zipfile.ZipFile(stream, mode="w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("main.py", "print('hi')\n")
    return stream.getvalue()
