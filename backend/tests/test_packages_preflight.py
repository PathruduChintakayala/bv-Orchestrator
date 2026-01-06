import io

from sqlmodel import select

from backend.models import Package

def test_preflight_can_publish_true_and_no_side_effects(client, session):
    before_count = len(session.exec(select(Package)).all())

    r = client.post(
        "/api/packages/preflight",
        json={"name": "demo-automation", "version": "1.2.3"},
    )
    assert r.status_code == 200
    assert r.json() == {"can_publish": True}

    after_count = len(session.exec(select(Package)).all())
    assert after_count == before_count

def test_preflight_existing_false_and_no_side_effects(client, session):
    # Create an existing package via the real upload endpoint.
    from backend.tests.conftest import make_bvpackage_bytes

    bv_bytes = make_bvpackage_bytes(name="demo-automation", version="1.2.3")
    files = {"file": ("demo-automation_1.2.3.bvpackage", io.BytesIO(bv_bytes), "application/zip")}
    upload = client.post("/api/packages/upload", files=files)
    assert upload.status_code == 200

    before_count = len(session.exec(select(Package)).all())

    r = client.post(
        "/api/packages/preflight",
        json={"name": "demo-automation", "version": "1.2.3"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["can_publish"] is False
    assert "Package demo-automation@1.2.3 already exists" in body.get("reason", "")

    after_count = len(session.exec(select(Package)).all())
    assert after_count == before_count

def test_preflight_invalid_semver(client, session):
    before_count = len(session.exec(select(Package)).all())

    r = client.post(
        "/api/packages/preflight",
        json={"name": "demo-automation", "version": "1.2"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["can_publish"] is False
    assert "SemVer" in body.get("reason", "")

    after_count = len(session.exec(select(Package)).all())
    assert after_count == before_count

def test_preflight_duplicate_reason_matches_upload_rule(client):
    from backend.tests.conftest import make_bvpackage_bytes

    bv_bytes = make_bvpackage_bytes(name="demo-automation", version="1.2.3")
    files = {"file": ("demo-automation_1.2.3.bvpackage", io.BytesIO(bv_bytes), "application/zip")}
    upload1 = client.post("/api/packages/upload", files=files)
    assert upload1.status_code == 200

    preflight = client.post(
        "/api/packages/preflight",
        json={"name": "demo-automation", "version": "1.2.3"},
    )
    assert preflight.status_code == 200
    reason = preflight.json().get("reason")

    upload2 = client.post("/api/packages/upload", files=files)
    assert upload2.status_code == 400
    assert upload2.json().get("detail") == reason
import io

from sqlmodel import select

from backend.models import Package


def test_preflight_can_publish_true_and_no_side_effects(client, session):
    before_count = len(session.exec(select(Package)).all())

    r = client.post(
        "/api/packages/preflight",
        json={"name": "demo-automation", "version": "1.2.3"},
    )
    assert r.status_code == 200
    assert r.json() == {"can_publish": True}

    after_count = len(session.exec(select(Package)).all())
    assert after_count == before_count


def test_preflight_existing_false_and_no_side_effects(client, session):
    # Create an existing package via the real upload endpoint.
    from backend.tests.conftest import make_bvpackage_bytes

    bv_bytes = make_bvpackage_bytes(name="demo-automation", version="1.2.3")
    files = {"file": ("demo-automation_1.2.3.bvpackage", io.BytesIO(bv_bytes), "application/zip")}
    upload = client.post("/api/packages/upload", files=files)
    assert upload.status_code == 200

    before_count = len(session.exec(select(Package)).all())

    r = client.post(
        "/api/packages/preflight",
        json={"name": "demo-automation", "version": "1.2.3"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["can_publish"] is False
    assert "Package demo-automation@1.2.3 already exists" in body.get("reason", "")

    after_count = len(session.exec(select(Package)).all())
    assert after_count == before_count


def test_preflight_invalid_semver(client, session):
    before_count = len(session.exec(select(Package)).all())

    r = client.post(
        "/api/packages/preflight",
        json={"name": "demo-automation", "version": "1.2"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["can_publish"] is False
    assert "SemVer" in body.get("reason", "")

    after_count = len(session.exec(select(Package)).all())
    assert after_count == before_count


def test_preflight_duplicate_reason_matches_upload_rule(client):
    from backend.tests.conftest import make_bvpackage_bytes

    bv_bytes = make_bvpackage_bytes(name="demo-automation", version="1.2.3")
    files = {"file": ("demo-automation_1.2.3.bvpackage", io.BytesIO(bv_bytes), "application/zip")}
    upload1 = client.post("/api/packages/upload", files=files)
    assert upload1.status_code == 200

    preflight = client.post(
        "/api/packages/preflight",
        json={"name": "demo-automation", "version": "1.2.3"},
    )
    assert preflight.status_code == 200
    reason = preflight.json().get("reason")

    upload2 = client.post("/api/packages/upload", files=files)
    assert upload2.status_code == 400
    assert upload2.json().get("detail") == reason
