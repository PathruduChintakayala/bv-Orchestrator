import json
import secrets
from datetime import datetime, timedelta
from hashlib import sha256
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi import Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt
from passlib.context import CryptContext
from sqlmodel import Session, select

from backend.db import get_session
from backend.models import User, Role, UserRole, RolePermission, UserInvite, PasswordResetToken, Setting
from backend.audit_utils import log_event
from backend.email_service import EmailService
from backend.permissions import require_permission
from backend.timezone_utils import get_display_timezone, to_display_iso

router = APIRouter(prefix="/auth", tags=["auth"])
invites_router = APIRouter(prefix="/users", tags=["users"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
SECRET_KEY = "dev-secret-change-me"  # for demo; move to env
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480
_BCRYPT_MAX_INPUT_BYTES = 72
INVITE_TOKEN_TTL_HOURS = 72
PASSWORD_RESET_TOKEN_TTL_MINUTES = 60


def _prepare_password_input(password: str) -> str:
    """Pre-hash passwords that exceed bcrypt's 72-byte input limit.

    Uses UTF-8 bytes to match passlib behavior. Keeps backward compatibility by
    returning the original password when within the limit.
    """
    password = password or ""
    raw_bytes = password.encode("utf-8")
    if len(raw_bytes) > _BCRYPT_MAX_INPUT_BYTES:
        return sha256(raw_bytes).hexdigest()
    return password

def verify_password(plain_password: str, hashed_password: str) -> bool:
    # Primary path: bcrypt-safe input (pre-hash if too long)
    candidate = _prepare_password_input(plain_password)
    try:
        if pwd_context.verify(candidate, hashed_password):
            return True
    except Exception:
        pass

    # Backward compatibility: try legacy verification if the password was hashed
    # without the pre-hash step.
    if candidate != plain_password:
        try:
            return pwd_context.verify(plain_password or "", hashed_password)
        except Exception:
            return False
    return False

def get_password_hash(password: str) -> str:
    return pwd_context.hash(_prepare_password_input(password))


def _hash_token(token: str) -> str:
    return sha256((token or "").encode("utf-8")).hexdigest()


def _generate_token() -> str:
    return secrets.token_urlsafe(32)


def _utcnow() -> datetime:
    return datetime.utcnow()


def _user_status(user: User) -> str:
    if not getattr(user, "is_active", True):
        return "disabled"
    if getattr(user, "locked_until", None) and user.locked_until > _utcnow():
        return "locked"
    return "active"


def _load_preferences(raw: Optional[object]):
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return {}

def _invite_status(invite: UserInvite) -> str:
    if invite.accepted_at:
        return "accepted"
    if getattr(invite, "revoked_at", None):
        return "revoked"
    if invite.expires_at <= _utcnow():
        return "expired"
    return "pending"

def _invite_response(invite: UserInvite, inviter: Optional[User] = None) -> dict:
    return {
        "id": invite.id,
        "email": invite.email,
        "status": _invite_status(invite),
        "invited_by": inviter.username if inviter else None,
        "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
        "created_at": invite.created_at.isoformat() if invite.created_at else None,
    }

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(
    request: Request,
    session: Session = Depends(get_session),
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
) -> User:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        token_version = payload.get("token_version")
        if not username:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = session.exec(select(User).where(User.username == username)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if token_version is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if int(token_version) != int(getattr(user, "token_version", 1) or 1):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not getattr(user, "is_admin", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    return user

def _get_security_setting(session: Session, key: str, default):
    setting = session.exec(select(Setting).where(Setting.key == f"security.{key}")).first()
    if setting is None:
        return default
    try:
        if setting.type == "int":
            return int(setting.value)
        if setting.type == "bool":
            return setting.value.lower() in ("true", "1", "yes", "on")
    except Exception:
        return default
    try:
        return int(setting.value)
    except Exception:
        return setting.value or default


@router.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), request: Request = None, session: Session = Depends(get_session)):
    stmt = select(User).where(User.username == form_data.username)
    user = session.exec(stmt).first()
    # Generic error to avoid account enumeration
    invalid_exc = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user:
        raise invalid_exc

    # Disabled
    if not getattr(user, "is_active", True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    # Locked
    now = _utcnow()
    if getattr(user, "locked_until", None) and user.locked_until > now:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account locked")

    max_failed = int(_get_security_setting(session, "max_failed_logins", 5) or 5)
    lock_minutes = int(_get_security_setting(session, "lockout_minutes", 15) or 15)

    if not verify_password(form_data.password, user.password_hash):
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        user.last_failed_login_at = now
        if max_failed > 0 and user.failed_login_attempts >= max_failed:
            user.locked_until = now + timedelta(minutes=lock_minutes)
            try:
                log_event(
                    session,
                    action="USER_LOCKED",
                    entity_type="user",
                    entity_id=user.id,
                    entity_name=user.username,
                    before=None,
                    after={"locked_until": user.locked_until.isoformat()},
                    metadata={"failed_login_attempts": user.failed_login_attempts},
                    request=request,
                    user=None,
                )
            except Exception:
                pass
            session.add(user)
            session.commit()
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account locked")
        session.add(user)
        session.commit()
        raise invalid_exc

    # Successful login: reset counters
    user.failed_login_attempts = 0
    user.last_failed_login_at = None
    user.locked_until = None
    user.last_login = now
    session.add(user)
    session.commit()

    token = create_access_token({"sub": user.username, "is_admin": user.is_admin, "token_version": getattr(user, "token_version", 1) or 1})
    return {"access_token": token, "token_type": "bearer"}

def ensure_admin_user(session: Session):
    existing = session.exec(select(User).where(User.username == "admin")).first()
    if existing:
        return existing
    admin_user = User(
        username="admin",
        password_hash=get_password_hash("admin123"),
        is_admin=True,
    )
    session.add(admin_user)
    session.commit()
    session.refresh(admin_user)
    return admin_user


@router.post("/register")
def register(payload: dict, session: Session = Depends(get_session)):
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="Public registration is disabled. Use an invite link.")


@router.post("/forgot")
def forgot_password(payload: dict, session: Session = Depends(get_session)):
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="Password resets are handled via reset links.")


@router.get("/me")
def get_me(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    # Local permission computation to avoid circular import
    by_artifact = {}
    flat = {}
    tz = get_display_timezone(session)
    prefs = _load_preferences(getattr(user, "preferences_json", None))
    if getattr(user, "is_admin", False):
        # Admin: allow all known artifacts and operations; build dynamically from assigned role permissions
        rps = session.exec(select(RolePermission)).all()
        arts = set([rp.artifact for rp in rps])
        for art in arts:
            by_artifact[art] = {"view": True, "create": True, "edit": True, "delete": True}
            flat[f"{art}:view"] = True
            flat[f"{art}:create"] = True
            flat[f"{art}:edit"] = True
            flat[f"{art}:delete"] = True
    else:
        urs = session.exec(select(UserRole).where(UserRole.user_id == user.id)).all()
        role_ids = [ur.role_id for ur in urs]
        if role_ids:
            rps = session.exec(select(RolePermission).where(RolePermission.role_id.in_(role_ids))).all()
            for rp in rps:
                art = rp.artifact
                if art not in by_artifact:
                    by_artifact[art] = {"view": False, "create": False, "edit": False, "delete": False}
                by_artifact[art]["view"] = by_artifact[art]["view"] or bool(rp.can_view)
                by_artifact[art]["create"] = by_artifact[art]["create"] or bool(rp.can_create)
                by_artifact[art]["edit"] = by_artifact[art]["edit"] or bool(rp.can_edit)
                by_artifact[art]["delete"] = by_artifact[art]["delete"] or bool(rp.can_delete)
                flat[f"{art}:view"] = by_artifact[art]["view"]
                flat[f"{art}:create"] = by_artifact[art]["create"]
                flat[f"{art}:edit"] = by_artifact[art]["edit"]
                flat[f"{art}:delete"] = by_artifact[art]["delete"]
    perms = {"by_artifact": by_artifact, "flat": flat}
    # include roles for convenience
    urs = session.exec(select(UserRole).where(UserRole.user_id == user.id)).all()
    role_ids = [ur.role_id for ur in urs]
    roles = []
    if role_ids:
        roles = session.exec(select(Role).where(Role.id.in_(role_ids))).all()
    return {
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "is_admin": user.is_admin,
            "full_name": getattr(user, "full_name", None),
            "display_name": getattr(user, "full_name", None),
            "status": _user_status(user),
            "locked_until": to_display_iso(getattr(user, "locked_until", None), tz),
            "last_login": to_display_iso(getattr(user, "last_login", None), tz),
            "preferences": prefs,
            "token_version": getattr(user, "token_version", 1) or 1,
        },
        "roles": [{"id": r.id, "name": r.name} for r in roles],
        "permissions": perms,
        "timezone": tz,
    }


@router.post("/invite", status_code=201)
@invites_router.post("/invite", status_code=201)
def create_invite(
    payload: dict,
    request: Request,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    user: User = Depends(require_permission("users", "create")),
):
    email = (payload.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    try:
        ttl_hours = int(payload.get("ttl_hours") or INVITE_TOKEN_TTL_HOURS)
    except Exception:
        ttl_hours = INVITE_TOKEN_TTL_HOURS
    if ttl_hours <= 0:
        ttl_hours = INVITE_TOKEN_TTL_HOURS
    expires_at = _utcnow() + timedelta(hours=ttl_hours)
    role_ids = payload.get("role_ids") or []
    try:
        role_ids_json = json.dumps(role_ids)
    except Exception:
        role_ids_json = "[]"

    token = _generate_token()
    invite = UserInvite(
        email=email,
        token_hash=_hash_token(token),
        role_ids_json=role_ids_json,
        full_name=(payload.get("full_name") or payload.get("fullName") or None),
        organization=payload.get("organization") or None,
        message=payload.get("message") or None,
        created_at=_utcnow(),
        expires_at=expires_at,
        created_by_user_id=user.id,
    )
    session.add(invite)
    session.commit()
    session.refresh(invite)

    base_url = payload.get("accept_base_url") or f"{str(request.base_url).rstrip('/')}/#/accept-invite"
    link = f"{base_url}?token={token}"
    subject = "You have been invited to BV Orchestrator"
    body = (
        "You have been invited to join BV Orchestrator.\n\n"
        f"Accept your invite: {link}\n"
        f"This invite expires at {invite.expires_at.isoformat()} UTC.\n"
    )
    EmailService(session).send_email(subject, body, to_addresses=[email], background_tasks=background_tasks)
    try:
        log_event(
            session,
            action="USER_INVITED",
            entity_type="user_invite",
            entity_id=invite.id,
            entity_name=email,
            before=None,
            after={"email": email, "expires_at": invite.expires_at.isoformat()},
            metadata={"created_by": user.username},
            request=request,
            user=user,
        )
    except Exception:
        pass
    return {"id": invite.id, "expires_at": invite.expires_at.isoformat(), "token": token}


@invites_router.get("/invites")
def list_invites(session: Session = Depends(get_session), user: User = Depends(require_permission("users", "view"))):
    invites = session.exec(select(UserInvite)).all()
    creator_ids = {i.created_by_user_id for i in invites if i.created_by_user_id}
    creators = {}
    if creator_ids:
        for u in session.exec(select(User).where(User.id.in_(creator_ids))).all():
            creators[u.id] = u
    return [_invite_response(i, creators.get(i.created_by_user_id)) for i in invites]


@invites_router.post("/invite/{invite_id}/resend")
def resend_invite(
    invite_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    payload: Optional[dict] = None,
    session: Session = Depends(get_session),
    user: User = Depends(require_permission("users", "create")),
):
    invite = session.get(UserInvite, invite_id)
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if invite.accepted_at:
        raise HTTPException(status_code=400, detail="Invite already used")
    if getattr(invite, "revoked_at", None):
        raise HTTPException(status_code=400, detail="Invite has been revoked")

    token = _generate_token()
    invite.token_hash = _hash_token(token)
    invite.expires_at = _utcnow() + timedelta(hours=INVITE_TOKEN_TTL_HOURS)
    session.add(invite)
    session.commit()
    session.refresh(invite)

    base_url = None
    if payload:
        base_url = payload.get("accept_base_url") or payload.get("acceptBaseUrl")
    base_url = base_url or f"{str(request.base_url).rstrip('/')}/#/accept-invite"
    link = f"{base_url}?token={token}"
    subject = "Your BV Orchestrator invite"
    body = (
        "You have been invited to join BV Orchestrator.\n\n"
        f"Accept your invite: {link}\n"
        f"This invite expires at {invite.expires_at.isoformat()} UTC.\n"
    )
    EmailService(session).send_email(subject, body, to_addresses=[invite.email], background_tasks=background_tasks)
    try:
        log_event(
            session,
            action="USER_INVITE_RESENT",
            entity_type="user_invite",
            entity_id=invite.id,
            entity_name=invite.email,
            before=None,
            after={"expires_at": invite.expires_at.isoformat()},
            metadata={"resent_by": user.username},
            request=request,
            user=user,
        )
    except Exception:
        pass

    inviter = session.get(User, invite.created_by_user_id) if invite.created_by_user_id else None
    return _invite_response(invite, inviter)


@invites_router.delete("/invite/{invite_id}", status_code=204)
def revoke_invite(
    invite_id: int,
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(require_permission("users", "create")),
):
    invite = session.get(UserInvite, invite_id)
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if invite.accepted_at:
        raise HTTPException(status_code=400, detail="Invite already used")

    invite.revoked_at = _utcnow()
    session.add(invite)
    session.commit()

    try:
        log_event(
            session,
            action="USER_INVITE_REVOKED",
            entity_type="user_invite",
            entity_id=invite.id,
            entity_name=invite.email,
            before=None,
            after={"revoked_at": invite.revoked_at.isoformat()},
            metadata={"revoked_by": user.username},
            request=request,
            user=user,
        )
    except Exception:
        pass
    return None


@router.post("/invite/accept")
def accept_invite(payload: dict, session: Session = Depends(get_session)):
    token = payload.get("token") or ""
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or payload.get("newPassword") or ""
    full_name = (payload.get("full_name") or payload.get("fullName") or "").strip()

    if not token:
        raise HTTPException(status_code=400, detail="Invite token is required")
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    if not password:
        raise HTTPException(status_code=400, detail="Password is required")

    invite = session.exec(select(UserInvite).where(UserInvite.token_hash == _hash_token(token))).first()
    if not invite:
        raise HTTPException(status_code=400, detail="Invite is invalid or expired")
    if getattr(invite, "revoked_at", None):
        raise HTTPException(status_code=400, detail="Invite has been revoked")
    if invite.accepted_at is not None:
        raise HTTPException(status_code=400, detail="Invite already used")
    if invite.expires_at <= _utcnow():
        raise HTTPException(status_code=400, detail="Invite is invalid or expired")

    if session.exec(select(User).where(User.username == username)).first():
        raise HTTPException(status_code=409, detail="A user with this username already exists")
    if invite.email and session.exec(select(User).where(User.email == invite.email)).first():
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    user = User(
        username=username,
        password_hash=get_password_hash(password),
        full_name=full_name or invite.full_name,
        email=invite.email,
        organization=invite.organization,
        is_admin=False,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    # Assign roles captured on invite, if any
    role_ids = []
    if invite.role_ids_json:
        try:
            role_ids = json.loads(invite.role_ids_json)
        except Exception:
            role_ids = []
    for rid in role_ids:
        try:
            session.add(UserRole(user_id=user.id, role_id=int(rid)))
        except Exception:
            continue
    invite.accepted_at = _utcnow()
    invite.accepted_by_user_id = user.id
    session.add(invite)
    session.commit()

    try:
        log_event(
            session,
            action="USER_INVITE_ACCEPTED",
            entity_type="user_invite",
            entity_id=invite.id,
            entity_name=invite.email,
            before=None,
            after={"accepted_by": user.username},
            metadata=None,
            request=None,
            user=user,
        )
    except Exception:
        pass
    return {"status": "accepted", "user_id": user.id, "username": user.username}


@router.post("/password-reset/request")
def request_password_reset(
    payload: dict,
    request: Request,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    username = (payload.get("username") or "").strip()
    email = (payload.get("email") or "").strip().lower()

    user = None
    if email:
        user = session.exec(select(User).where(User.email == email)).first()
    if user is None and username:
        user = session.exec(select(User).where(User.username == username)).first()

    token = _generate_token()
    # Always respond OK to avoid leaking whether the user exists
    if user:
        expires_at = _utcnow() + timedelta(minutes=PASSWORD_RESET_TOKEN_TTL_MINUTES)
        prt = PasswordResetToken(
            user_id=user.id,
            token_hash=_hash_token(token),
            created_at=_utcnow(),
            expires_at=expires_at,
            created_ip=request.client.host if request and request.client else None,
        )
        session.add(prt)
        session.commit()
        session.refresh(prt)

        base_url = payload.get("reset_base_url") or f"{str(request.base_url).rstrip('/')}/#/reset-password"
        link = f"{base_url}?token={token}"
        subject = "Reset your BV Orchestrator password"
        body = (
            "You requested a password reset. If you did not request this, you can ignore this email.\n\n"
            f"Reset link: {link}\n"
            f"This link expires at {expires_at.isoformat()} UTC.\n"
        )
        EmailService(session).send_email(subject, body, to_addresses=[user.email], background_tasks=background_tasks)
        try:
            log_event(
                session,
                action="PASSWORD_RESET_REQUESTED",
                entity_type="user",
                entity_id=user.id,
                entity_name=user.username,
                before=None,
                after=None,
                metadata={"reset_token_id": prt.id},
                request=request,
                user=None,
            )
        except Exception:
            pass

    return {"status": "ok"}


@router.post("/password-reset/confirm")
def confirm_password_reset(payload: dict, request: Request, session: Session = Depends(get_session)):
    token = payload.get("token") or ""
    new_password = payload.get("newPassword") or payload.get("password") or ""

    if not token:
        raise HTTPException(status_code=400, detail="Reset token is required")
    if not new_password:
        raise HTTPException(status_code=400, detail="New password is required")

    prt = session.exec(select(PasswordResetToken).where(PasswordResetToken.token_hash == _hash_token(token))).first()
    if not prt or prt.used_at is not None or prt.expires_at <= _utcnow():
        raise HTTPException(status_code=400, detail="Reset link is invalid or expired")

    user = session.get(User, prt.user_id)
    if not user:
        raise HTTPException(status_code=400, detail="Reset link is invalid or expired")

    user.password_hash = get_password_hash(new_password)
    user.failed_login_attempts = 0
    user.last_failed_login_at = None
    user.locked_until = None
    user.token_version = (getattr(user, "token_version", 1) or 1) + 1
    prt.used_at = _utcnow()
    session.add(user)
    session.add(prt)
    session.commit()

    try:
        log_event(
            session,
            action="PASSWORD_CHANGED",
            entity_type="user",
            entity_id=user.id,
            entity_name=user.username,
            before=None,
            after=None,
            metadata={"reset_token_id": prt.id},
            request=request,
            user=None,
        )
    except Exception:
        pass
    return {"status": "ok"}
