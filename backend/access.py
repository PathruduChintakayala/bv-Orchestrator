from typing import List, Optional, Dict
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from sqlmodel import Session, select, delete
from datetime import datetime, timedelta

from backend.db import get_session
from backend.auth import get_current_user, _generate_token, _hash_token, _utcnow
from backend.models import Role, RolePermission, User, UserRole, PasswordResetToken
from backend.audit_utils import log_event, diff_dicts
from backend.permissions import require_permission, ARTIFACTS
from backend.email_service import EmailService
from backend.email_templates import render_password_reset_email, resolve_ui_base_url
from backend.timezone_utils import get_display_timezone, to_display_iso
from backend.auth import PASSWORD_RESET_TOKEN_TTL_MINUTES

PERMISSIONS = ["view", "create", "edit", "delete"]

router = APIRouter(prefix="/access", tags=["access"])  # mounted under /api


def utcnow_iso() -> str:
    return datetime.utcnow().isoformat()


def _get_role_by_external_id(session: Session, external_id: str) -> Role:
    """Resolve role by external_id (public GUID). Numeric IDs are rejected for management routes."""
    try:
        int(external_id)
        raise HTTPException(status_code=400, detail="Role identifiers must be external_id (GUID)")
    except ValueError:
        pass
    role = session.exec(select(Role).where(Role.external_id == external_id)).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    return role


def _get_user_by_external_id(session: Session, external_id: str) -> User:
    """Resolve user by external_id (public GUID). Numeric IDs are rejected for management routes."""
    try:
        int(external_id)
        raise HTTPException(status_code=400, detail="User identifiers must be external_id (GUID)")
    except ValueError:
        pass
    user = session.exec(select(User).where(User.external_id == external_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _role_to_dict(session: Session, role: Role) -> Dict:
    perms = session.exec(select(RolePermission).where(RolePermission.role_id == role.id)).all()
    return {
        "id": getattr(role, "external_id", None) or str(role.id),
        "_internal_id": role.id,  # deprecated: prefer id (external_id)
        "name": role.name,
        "description": role.description,
        "created_at": role.created_at,
        "updated_at": role.updated_at,
        "permissions": [
            {
                "id": p.id,
                "artifact": p.artifact,
                "can_view": p.can_view,
                "can_create": p.can_create,
                "can_edit": p.can_edit,
                "can_delete": p.can_delete,
            }
            for p in perms
        ],
    }


def ensure_default_roles(session: Session) -> None:
    now = utcnow_iso()
    # Administrator: all permissions for all artifacts
    admin = session.exec(select(Role).where(Role.name == "Administrator")).first()
    if not admin:
        admin = Role(name="Administrator", description="Full access to all features", created_at=now, updated_at=now)
        session.add(admin)
        session.commit()
        session.refresh(admin)
    # Recreate permissions for Administrator
    session.exec(delete(RolePermission).where(RolePermission.role_id == admin.id))
    for art in ARTIFACTS:
        rp = RolePermission(
            role_id=admin.id,
            artifact=art,
            can_view=True,
            can_create=True,
            can_edit=True,
            can_delete=True,
        )
        session.add(rp)
    admin.updated_at = utcnow_iso()
    session.add(admin)
    session.commit()

    # Read Only: view-only permissions across all artifacts
    ro = session.exec(select(Role).where(Role.name == "Read Only")).first()
    if not ro:
        ro = Role(name="Read Only", description="View-only access across all modules", created_at=now, updated_at=now)
        session.add(ro)
        session.commit()
        session.refresh(ro)
    session.exec(delete(RolePermission).where(RolePermission.role_id == ro.id))
    for art in ARTIFACTS:
        rp = RolePermission(
            role_id=ro.id,
            artifact=art,
            can_view=True,
            can_create=False,
            can_edit=False,
            can_delete=False,
        )
        session.add(rp)
    ro.updated_at = utcnow_iso()
    session.add(ro)
    session.commit()

    # Assign Administrator role to all users flagged as is_admin
    admins = session.exec(select(User).where(User.is_admin == True)).all()
    for u in admins:
        existing = session.exec(select(UserRole).where(UserRole.user_id == u.id, UserRole.role_id == admin.id)).first()
        if not existing:
            session.add(UserRole(user_id=u.id, role_id=admin.id))
    session.commit()


@router.get("/roles", response_model=List[dict], dependencies=[Depends(require_permission("roles", "view"))])
def list_roles(session: Session = Depends(get_session), user=Depends(get_current_user)):
    roles = session.exec(select(Role)).all()
    return [_role_to_dict(session, r) for r in roles]


@router.get("/roles/{role_external_id}", response_model=dict, dependencies=[Depends(require_permission("roles", "view"))])
def get_role(role_external_id: str, session: Session = Depends(get_session), user=Depends(get_current_user)):
    role = _get_role_by_external_id(session, role_external_id)
    return _role_to_dict(session, role)


@router.post("/roles", response_model=dict, status_code=201, dependencies=[Depends(require_permission("roles", "create"))])
def create_role(payload: dict, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Role name is required")
    # unique name
    existing = session.exec(select(Role).where(Role.name == name)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Role name already exists")
    perms_input = payload.get("permissions") or []
    now = utcnow_iso()
    role = Role(name=name, description=payload.get("description"), created_at=now, updated_at=now)
    session.add(role)
    session.commit()
    session.refresh(role)

    for p in perms_input:
        art = p.get("artifact")
        if art not in ARTIFACTS:
            continue
        rp = RolePermission(
            role_id=role.id,
            artifact=art,
            can_view=bool(p.get("can_view")),
            can_create=bool(p.get("can_create")),
            can_edit=bool(p.get("can_edit")),
            can_delete=bool(p.get("can_delete")),
        )
        session.add(rp)
    session.commit()
    out = _role_to_dict(session, role)
    try:
        log_event(session, action="role.create", entity_type="role", entity_id=role.id, entity_name=role.name, before=None, after=out, metadata=None, request=request, user=user)
    except Exception:
        pass
    return out


@router.put("/roles/{role_external_id}", response_model=dict, dependencies=[Depends(require_permission("roles", "edit"))])
def update_role(role_external_id: str, payload: dict, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    role = _get_role_by_external_id(session, role_external_id)
    before = _role_to_dict(session, role)
    if (nm := payload.get("name")) is not None:
        nm = nm.strip()
        if not nm:
            raise HTTPException(status_code=400, detail="Role name cannot be empty")
        other = session.exec(select(Role).where(Role.name == nm, Role.id != role.id)).first()
        if other:
            raise HTTPException(status_code=400, detail="Role name already exists")
        role.name = nm
    if "description" in payload:
        role.description = payload.get("description")
    role.updated_at = utcnow_iso()
    session.add(role)

    if payload.get("permissions") is not None:
        # replace permissions
        session.exec(delete(RolePermission).where(RolePermission.role_id == role.id))
        session.commit()
        for p in payload.get("permissions") or []:
            art = p.get("artifact")
            if art not in ARTIFACTS:
                continue
            rp = RolePermission(
                role_id=role.id,
                artifact=art,
                can_view=bool(p.get("can_view")),
                can_create=bool(p.get("can_create")),
                can_edit=bool(p.get("can_edit")),
                can_delete=bool(p.get("can_delete")),
            )
            session.add(rp)
    session.commit()
    out = _role_to_dict(session, role)
    try:
        changes = diff_dicts(before, out)
        log_event(session, action="role.update", entity_type="role", entity_id=role.id, entity_name=role.name, before=before, after=out, metadata={"changed_keys": list(changes.keys()), "diff": changes}, request=request, user=user)
    except Exception:
        pass
    return out


@router.delete("/roles/{role_external_id}", status_code=204, dependencies=[Depends(require_permission("roles", "delete"))])
def delete_role(role_external_id: str, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    role = _get_role_by_external_id(session, role_external_id)
    before = _role_to_dict(session, role)
    session.exec(delete(RolePermission).where(RolePermission.role_id == role.id))
    session.exec(delete(UserRole).where(UserRole.role_id == role.id))
    session.delete(role)
    session.commit()
    try:
        log_event(session, action="role.delete", entity_type="role", entity_id=role.id, entity_name=before.get("name"), before=before, after=None, metadata=None, request=request, user=user)
    except Exception:
        pass
    return None


# Users & roles assignment
@router.get("/users", response_model=List[dict], dependencies=[Depends(require_permission("users", "view"))])
def list_users(session: Session = Depends(get_session), user=Depends(get_current_user)):
    users = session.exec(select(User)).all()
    user_ids = [u.id for u in users]

    roles_by_user = {uid: [] for uid in user_ids}
    if user_ids:
        user_roles = session.exec(select(UserRole).where(UserRole.user_id.in_(user_ids))).all()
        role_ids = {ur.role_id for ur in user_roles}
        role_lookup = {}
        if role_ids:
            role_lookup = {r.id: r for r in session.exec(select(Role).where(Role.id.in_(role_ids))).all()}
        for ur in user_roles:
            role_obj = role_lookup.get(ur.role_id)
            if role_obj:
                roles_by_user.setdefault(ur.user_id, []).append(role_obj.name)

    return [_user_summary(u, roles_by_user.get(u.id, [])) for u in users]


def _user_summary(u: User, roles: List[str]) -> Dict:
    now = datetime.utcnow()
    status = "active"
    if not getattr(u, "is_active", True):
        status = "disabled"
    elif getattr(u, "locked_until", None) and u.locked_until > now:
        status = "locked"
    return {
        "id": getattr(u, "external_id", None) or str(u.id),
        "_internal_id": u.id,  # deprecated: prefer id (external_id)
        "username": u.username,
        "email": u.email,
        "is_active": getattr(u, "is_active", True),
        "status": status,
        "locked_until": u.locked_until.isoformat() if getattr(u, "locked_until", None) else None,
        "roles": roles,
        "last_login": getattr(u, "last_login", None).isoformat() if getattr(u, "last_login", None) else None,
    }


def _user_role_names(session: Session, user_id: int) -> List[str]:
    urs = session.exec(select(UserRole).where(UserRole.user_id == user_id)).all()
    role_ids = [ur.role_id for ur in urs]
    if not role_ids:
        return []
    roles = session.exec(select(Role).where(Role.id.in_(role_ids))).all()
    return [r.name for r in roles]


@router.get("/users/{user_external_id}/roles", response_model=dict, dependencies=[Depends(require_permission("users", "view"))])
def get_user_roles(user_external_id: str, session: Session = Depends(get_session), user=Depends(get_current_user)):
    u = _get_user_by_external_id(session, user_external_id)
    if not u.email and (u.username or "").lower() != "admin":
        raise HTTPException(status_code=400, detail="User has no email configured")
    # roles for user
    urs = session.exec(select(UserRole).where(UserRole.user_id == u.id)).all()
    role_ids = [ur.role_id for ur in urs]
    roles = []
    if role_ids:
        roles = session.exec(select(Role).where(Role.id.in_(role_ids))).all()
    return {
        "user": {
            "id": getattr(u, "external_id", None) or str(u.id),
            "_internal_id": u.id,  # deprecated: prefer id (external_id)
            "username": u.username,
            "email": u.email,
            "is_active": True,
        },
        "roles": [_role_to_dict(session, r) for r in roles],
    }


@router.post("/users/{user_external_id}/roles", response_model=dict, dependencies=[Depends(require_permission("users", "edit"))])
def assign_user_roles(user_external_id: str, payload: dict, request: Request, session: Session = Depends(get_session), user=Depends(get_current_user)):
    u = _get_user_by_external_id(session, user_external_id)
    role_ids = payload.get("role_ids") or []
    # validate roles exist
    if role_ids:
        count = session.exec(select(Role).where(Role.id.in_(role_ids))).all()
        if len(count) != len(role_ids):
            raise HTTPException(status_code=400, detail="One or more roles do not exist")
    # clear
    session.exec(delete(UserRole).where(UserRole.user_id == u.id))
    # assign
    for rid in role_ids:
        session.add(UserRole(user_id=u.id, role_id=rid))
    session.commit()
    out = get_user_roles(user_external_id, session)
    try:
        log_event(session, action="user.roles.assign", entity_type="user", entity_id=u.id, entity_name=u.username, before=None, after={"role_ids": role_ids}, metadata=None, request=request, user=user)
    except Exception:
        pass
    return out


@router.post("/users/{user_external_id}/disable", status_code=200, dependencies=[Depends(require_permission("users", "edit"))])
def disable_user(user_external_id: str, request: Request, session: Session = Depends(get_session), actor=Depends(get_current_user)):
    u = _get_user_by_external_id(session, user_external_id)
    before = _user_summary(u, _user_role_names(session, u.id))
    u.is_active = False
    u.disabled_at = _utcnow()
    u.disabled_by_user_id = getattr(actor, "id", None)
    u.token_version = (getattr(u, "token_version", 1) or 1) + 1
    session.add(u)
    session.commit()
    try:
        log_event(
            session,
            action="USER_DISABLED",
            entity_type="user",
            entity_id=u.id,
            entity_name=u.username,
            before=before,
            after=_user_summary(u, _user_role_names(session, u.id)),
            metadata={"disabled_by": getattr(actor, "username", None)},
            request=request,
            user=actor,
        )
    except Exception:
        pass
    return _user_summary(u, _user_role_names(session, u.id))


@router.post("/users/{user_external_id}/enable", status_code=200, dependencies=[Depends(require_permission("users", "edit"))])
def enable_user(user_external_id: str, request: Request, session: Session = Depends(get_session), actor=Depends(get_current_user)):
    u = _get_user_by_external_id(session, user_external_id)
    before = _user_summary(u, _user_role_names(session, u.id))
    u.is_active = True
    u.disabled_at = None
    u.disabled_by_user_id = None
    u.failed_login_attempts = 0
    u.last_failed_login_at = None
    u.locked_until = None
    session.add(u)
    session.commit()
    try:
        log_event(
            session,
            action="USER_ENABLED",
            entity_type="user",
            entity_id=u.id,
            entity_name=u.username,
            before=before,
            after=_user_summary(u, _user_role_names(session, u.id)),
            metadata={"enabled_by": getattr(actor, "username", None)},
            request=request,
            user=actor,
        )
    except Exception:
        pass
    return _user_summary(u, _user_role_names(session, u.id))


@router.post("/users/{user_external_id}/password-reset", status_code=200, dependencies=[Depends(require_permission("users", "edit"))])
def admin_password_reset(
    user_external_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    payload: Optional[dict] = None,
    session: Session = Depends(get_session),
    actor=Depends(get_current_user),
):
    u = _get_user_by_external_id(session, user_external_id)

    token = _generate_token()
    expires_at = _utcnow() + timedelta(minutes=PASSWORD_RESET_TOKEN_TTL_MINUTES)
    prt = PasswordResetToken(
        user_id=u.id,
        token_hash=_hash_token(token),
        created_at=_utcnow(),
        expires_at=expires_at,
        created_ip=request.client.host if request and request.client else None,
    )
    session.add(prt)
    session.commit()
    session.refresh(prt)

    tz = get_display_timezone(session)
    base_url = None
    if payload:
        base_url = payload.get("reset_base_url") or payload.get("resetBaseUrl")
    ui_base_url = base_url or resolve_ui_base_url(session, request)
    content = render_password_reset_email(
        ui_base_url=ui_base_url,
        token=token,
        expires_at_display=to_display_iso(expires_at, tz),
        timezone=tz,
        initiated_by_admin=True,
    )
    email_sent = EmailService(session).send_email(
        subject=content.subject,
        body=content.text_body,
        html_body=content.html_body,
        to_addresses=[u.email],
        background_tasks=background_tasks,
    )

    try:
        log_event(
            session,
            action="ADMIN_PASSWORD_RESET_REQUESTED",
            entity_type="user",
            entity_id=u.id,
            entity_name=u.username,
            before=None,
            after=None,
            metadata={"reset_token_id": prt.id, "requested_by": getattr(actor, "username", None), "email_sent": email_sent},
            request=request,
            user=actor,
        )
    except Exception:
        pass

    return {"status": "queued"}
