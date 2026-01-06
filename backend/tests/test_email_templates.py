from backend.email_templates import (
    build_ui_link,
    render_alert_email,
    render_invite_email,
    render_password_reset_email,
)


def test_invite_email_includes_link_and_subject():
    content = render_invite_email(
        ui_base_url="https://app.example.com/#",
        token="abc123",
        expires_at_display="2025-01-02T00:00:00Z",
        timezone="UTC",
    )
    assert "accept-invite/abc123" in content.html_body
    assert "https://app.example.com/#/accept-invite/abc123" in content.text_body
    assert content.subject.startswith("You've been invited")


def test_password_reset_email_uses_reset_path():
    content = render_password_reset_email(
        ui_base_url="https://orchestrator.test/#",
        token="reset-token",
        expires_at_display=None,
        timezone="UTC",
        initiated_by_admin=True,
    )
    assert "/reset-password/reset-token" in content.html_body
    assert "Reset Password" in content.text_body
    assert content.subject == "Reset your BV Orchestrator password"


def test_alert_email_sanitizes_metadata():
    noisy_error = "Line1\nLine2 with secrets"
    content = render_alert_email(
        alert_type="Job failed",
        entity_name="Demo Job",
        occurred_at="2025-01-01T00:00:00Z",
        metadata=[("Error", noisy_error)],
        ui_base_url="https://bv.example.com/#",
        cta_path="automations/jobs?jobId=42",
    )
    assert "automations/jobs?jobId=42" in content.html_body
    assert "Line1 Line2" in content.text_body
    assert content.subject == "Job failed: Demo Job"


def test_build_ui_link_handles_empty_base():
    assert build_ui_link("", "accept-invite/token") == "/accept-invite/token"
    assert build_ui_link("https://host/#", "reset-password/abc") == "https://host/#/reset-password/abc"
