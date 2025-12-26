import json


def test_upload_valid_bvpackage_succeeds(client):
    from backend.tests.conftest import make_bvpackage_bytes

    data = make_bvpackage_bytes(name="demo", version="1.2.3")
    files = {"file": ("demo.bvpackage", data, "application/zip")}
    resp = client.post("/api/packages/upload", files=files)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "demo"
    assert body["version"] == "1.2.3"
    assert body["is_bvpackage"] is True
    assert isinstance(body["entrypoints"], list)
    assert body["default_entrypoint"] == "main"


def test_upload_bvpackage_missing_bvproject_fails(client):
    import io
    import zipfile

    stream = io.BytesIO()
    with zipfile.ZipFile(stream, mode="w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("entry-points.json", "[]")
        z.writestr("pyproject.toml", "[project]\nname='x'\n")
    files = {"file": ("bad.bvpackage", stream.getvalue(), "application/zip")}

    resp = client.post("/api/packages/upload", files=files)
    assert resp.status_code == 400
    assert "Missing required file(s): bvproject.yaml" in resp.json()["detail"]


def test_upload_bvpackage_multiple_default_entrypoints_fails(client):
    from backend.tests.conftest import make_bvpackage_bytes

    eps = [
        {"name": "a", "command": "m.a:f", "default": True},
        {"name": "b", "command": "m.b:f", "default": True},
    ]
    data = make_bvpackage_bytes(name="demo", version="1.2.3", entrypoints=eps)
    files = {"file": ("demo.bvpackage", data, "application/zip")}

    resp = client.post("/api/packages/upload", files=files)
    assert resp.status_code == 400
    assert "exactly one entrypoint" in resp.json()["detail"]


def test_upload_bvpackage_invalid_semver_fails(client):
    from backend.tests.conftest import make_bvpackage_bytes

    data = make_bvpackage_bytes(name="demo", version="1.2")
    files = {"file": ("demo.bvpackage", data, "application/zip")}

    resp = client.post("/api/packages/upload", files=files)
    assert resp.status_code == 400
    assert "SemVer" in resp.json()["detail"]


def test_upload_bvpackage_duplicate_name_version_fails(client):
    from backend.tests.conftest import make_bvpackage_bytes

    data = make_bvpackage_bytes(name="demo", version="1.2.3")
    files = {"file": ("demo.bvpackage", data, "application/zip")}

    resp1 = client.post("/api/packages/upload", files=files)
    assert resp1.status_code == 200, resp1.text

    resp2 = client.post("/api/packages/upload", files=files)
    assert resp2.status_code == 400
    assert "already exists" in resp2.json()["detail"].lower()


def test_create_process_with_valid_entrypoint_succeeds(client):
    from backend.tests.conftest import make_bvpackage_bytes

    pkg_bytes = make_bvpackage_bytes(name="demo", version="1.2.3")
    up = client.post("/api/packages/upload", files={"file": ("demo.bvpackage", pkg_bytes, "application/zip")})
    assert up.status_code == 200, up.text
    pkg_id = up.json()["id"]

    resp = client.post(
        "/api/processes",
        json={
            "name": "proc1",
            "package_id": pkg_id,
            "entrypoint_name": "main",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["package_id"] == pkg_id
    assert body["entrypoint_name"] == "main"
    # script_path is ignored for BV packages; stored as empty string for DB compatibility
    assert body["script_path"] == ""


def test_create_process_with_invalid_entrypoint_fails(client):
    from backend.tests.conftest import make_bvpackage_bytes

    pkg_bytes = make_bvpackage_bytes(name="demo", version="1.2.3")
    up = client.post("/api/packages/upload", files={"file": ("demo.bvpackage", pkg_bytes, "application/zip")})
    assert up.status_code == 200, up.text
    pkg_id = up.json()["id"]

    resp = client.post(
        "/api/processes",
        json={
            "name": "proc2",
            "package_id": pkg_id,
            "entrypoint_name": "does-not-exist",
        },
    )
    assert resp.status_code == 400
    assert "does not exist" in resp.json()["detail"].lower()


def test_create_job_snapshots_package_and_entrypoint(client):
    from backend.tests.conftest import make_bvpackage_bytes

    pkg_bytes = make_bvpackage_bytes(name="demo", version="1.2.3")
    up = client.post("/api/packages/upload", files={"file": ("demo.bvpackage", pkg_bytes, "application/zip")})
    assert up.status_code == 200, up.text
    pkg = up.json()

    proc = client.post(
        "/api/processes",
        json={
            "name": "proc3",
            "package_id": pkg["id"],
            "entrypoint_name": "main",
        },
    )
    assert proc.status_code == 201, proc.text
    proc_id = proc.json()["id"]

    job = client.post("/api/jobs", json={"process_id": proc_id, "parameters": {"x": 1}})
    assert job.status_code == 201, job.text
    body = job.json()
    assert body["package_id"] == pkg["id"]
    assert body["package_name"] == "demo"
    assert body["package_version"] == "1.2.3"
    assert body["entrypoint_name"] == "main"
