from datetime import datetime, timedelta
from hashlib import sha256
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi import Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt
from passlib.context import CryptContext
from sqlmodel import Session, select

from backend.db import get_session
from backend.models import User, Role, UserRole, RolePermission
from backend.audit_utils import log_event

router = APIRouter(prefix="/auth", tags=["auth"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
SECRET_KEY = "dev-secret-change-me"  # for demo; move to env
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480
_BCRYPT_MAX_INPUT_BYTES = 72


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
        if not username:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = session.exec(select(User).where(User.username == username)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user

@router.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), request: Request = None, session: Session = Depends(get_session)):
    stmt = select(User).where(User.username == form_data.username)
    user = session.exec(stmt).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token({"sub": user.username, "is_admin": user.is_admin})
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
    username = (payload.get("username") or "").strip()
    email = (payload.get("email") or "").strip().lower()
    full_name = (payload.get("fullName") or "").strip()
    organization = (payload.get("organization") or "").strip()
    role = (payload.get("role") or "").strip()
    password = payload.get("password") or ""

    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    if not password:
        raise HTTPException(status_code=400, detail="Password is required")

    if session.exec(select(User).where(User.username == username)).first():
        raise HTTPException(status_code=409, detail="A user with this username already exists")
    if email and session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    user = User(
        username=username,
        password_hash=get_password_hash(password),
        full_name=full_name or None,
        email=email or None,
        organization=organization or None,
        role=role or None,
        is_admin=False,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return {"id": user.id, "username": user.username}


@router.post("/forgot")
def forgot_password(payload: dict, session: Session = Depends(get_session)):
    username = (payload.get("username") or "").strip()
    email = (payload.get("email") or "").strip().lower()
    new_password = payload.get("newPassword") or ""

    if not username or not email or not new_password:
        raise HTTPException(status_code=400, detail="username, email and newPassword are required")

    user = session.exec(select(User).where(User.username == username)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if (user.email or "").lower() != email:
        raise HTTPException(status_code=400, detail="Email does not match this user")

    user.password_hash = get_password_hash(new_password)
    session.add(user)
    session.commit()
    session.refresh(user)
    return {"status": "ok"}


@router.get("/me")
def get_me(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    # Local permission computation to avoid circular import
    by_artifact = {}
    flat = {}
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
        },
        "roles": [{"id": r.id, "name": r.name} for r in roles],
        "permissions": perms,
    }
