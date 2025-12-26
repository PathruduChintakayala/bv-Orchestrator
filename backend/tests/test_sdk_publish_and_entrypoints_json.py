import io
import json
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

import backend.main as main_mod
from backend.auth import create_access_token
from backend.db import get_session
from backend.models import User
from backend.packages import router as packages_router
from backend.sdk_auth import router as sdk_auth_router


def _make_bvpackage_bytes_with_entry_points_json(*, name: str, version: str, entry_points_json: str) -> bytes:
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

    stream = io.BytesIO()
    with zipfile.ZipFile(stream, mode="w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("bvproject.yaml", bvproject_yaml)
        z.writestr("entry-points.json", entry_points_json)
        z.writestr("pyproject.toml", "[project]\nname = 'demo'\n")
        z.writestr("demo/__init__.py", "")
        z.writestr("demo/main.py", "def run():\n    return 0\n")
    return stream.getvalue()


@pytest.fixture()
def sdk_app_and_session(tmp_path, monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    session = Session(engine)

    # Create an admin user the SDK session can bind to.
    admin = User(id=1, username="admin", password_hash="x", is_admin=True)
    session.add(admin)
    session.commit()

    def _get_session_override():
        yield session

    app = FastAPI()
    # Register the same SDK token guard middleware used in production.
    app.middleware("http")(main_mod.sdk_token_guard)
    app.include_router(packages_router, prefix="/api")
    app.include_router(sdk_auth_router, prefix="/api")

    app.dependency_overrides[get_session] = _get_session_override

    yield app, session

    session.close()


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_entry_points_json_arbitrary_valid_json_is_accepted(sdk_app_and_session):
    app, session = sdk_app_and_session
    client = TestClient(app)

    token = create_access_token({"sub": "admin", "is_admin": True})

    # entry-points.json is arbitrary JSON (not the expected schema) but valid.
    data = _make_bvpackage_bytes_with_entry_points_json(
        name="demo-automation",
        version="1.2.3",
        entry_points_json=json.dumps({"hello": [1, 2, 3], "note": "anything"}),
    )

    files = {"file": ("demo-automation.bvpackage", io.BytesIO(data), "application/zip")}
    r = client.post("/api/packages/upload", files=files, headers=_auth_header(token))
    assert r.status_code == 200, r.text
    body = r.json()

    # Entrypoints are sourced from bvproject.yaml.
    assert body["name"] == "demo-automation"
    assert body["version"] == "1.2.3"
    assert body["default_entrypoint"] == "main"
    assert isinstance(body["entrypoints"], list)
    assert any(ep.get("name") == "main" for ep in body["entrypoints"])


def test_sdk_publish_preflight_then_upload_succeeds_and_sdk_token_allowed(sdk_app_and_session):
    app, session = sdk_app_and_session
    client = TestClient(app)

    # Start + confirm SDK session to mint an auth_type=sdk token.
    start = client.post("/api/sdk/auth/start", json={"machine_name": "m1"})
    assert start.status_code == 200
    sid = start.json()["session_id"]

    ui_token = create_access_token({"sub": "admin", "is_admin": True})
    confirm = client.post("/api/sdk/auth/confirm", json={"session_id": sid}, headers=_auth_header(ui_token))
    assert confirm.status_code == 200

    status = client.get(f"/api/sdk/auth/status?session_id={sid}")
    assert status.status_code == 200
    sdk_token = status.json()["access_token"]

    # Preflight allowed for SDK token.
    preflight = client.post(
        "/api/packages/preflight",
        json={"name": "demo-automation", "version": "1.2.3"},
        headers=_auth_header(sdk_token),
    )
    assert preflight.status_code == 200
    assert preflight.json() == {"can_publish": True}

    # Upload allowed for SDK token.
    data = _make_bvpackage_bytes_with_entry_points_json(
        name="demo-automation",
        version="1.2.3",
        entry_points_json=json.dumps({"any": "json"}),
    )
    files = {"file": ("demo-automation.bvpackage", io.BytesIO(data), "application/zip")}
    upload = client.post("/api/packages/upload", files=files, headers=_auth_header(sdk_token))
    assert upload.status_code == 200, upload.text

    # Duplicate rejected consistently.
    preflight2 = client.post(
        "/api/packages/preflight",
        json={"name": "demo-automation", "version": "1.2.3"},
        headers=_auth_header(sdk_token),
    )
    assert preflight2.status_code == 200
    assert preflight2.json()["can_publish"] is False
    assert "already exists" in preflight2.json().get("reason", "").lower()


def test_upload_rejects_non_bvpackage_extension(sdk_app_and_session):
    app, session = sdk_app_and_session
    client = TestClient(app)

    token = create_access_token({"sub": "admin", "is_admin": True})

    data = b"not a zip"
    files = {"file": ("demo.zip", io.BytesIO(data), "application/zip")}
    r = client.post("/api/packages/upload", files=files, headers=_auth_header(token))
    assert r.status_code == 400
    assert r.json().get("detail") == "Only .bvpackage files are supported"
