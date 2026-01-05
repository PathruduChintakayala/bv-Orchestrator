from fastapi import Depends, HTTPException
from sqlmodel import Session, select
from typing import Literal, Dict

from backend.db import get_session
from backend.models import RolePermission, UserRole, User

Operation = Literal["view", "create", "edit", "delete"]

# Central list of artifacts used across the app
ARTIFACTS = [
    "dashboard",
    "machines",
    "processes",
    "packages",
    "assets",
    "jobs",
    "robots",
    "queues",
    "queue_items",
    "credential_stores",
    "users",
    "roles",
    "audit",
    "settings",
]

def has_permission(session: Session, user: User, artifact: str, operation: Operation) -> bool:
    if not user:
        return False
    if getattr(user, "is_admin", False):
        return True
    uid = getattr(user, "id", None)
    if not uid:
        return False
    urs = session.exec(select(UserRole).where(UserRole.user_id == uid)).all()
    role_ids = [ur.role_id for ur in urs]
    if not role_ids:
        return False
    rps = session.exec(select(RolePermission).where(RolePermission.role_id.in_(role_ids), RolePermission.artifact == artifact)).all()
    for rp in rps:
        if operation == "view" and rp.can_view:
            return True
        if operation == "create" and rp.can_create:
            return True
        if operation == "edit" and rp.can_edit:
            return True
        if operation == "delete" and rp.can_delete:
            return True
    return False

def require_permission(artifact: str, operation: Operation):
    def _dep(
        session: Session = Depends(get_session),
        user: User = Depends(__import__("backend.auth", fromlist=["get_current_user"]).get_current_user),
    ):
        if not has_permission(session, user, artifact, operation):
            raise HTTPException(status_code=403, detail="Forbidden")
        return True
    return _dep


def compute_user_permissions(session: Session, user: User) -> Dict:
    """Compute a permissions map for the given user across all artifacts.

    Returns a dict with:
    - by_artifact: { artifact: { view, create, edit, delete } }
    - flat: { "artifact:view": bool, ... }
    """
    # Initialize all to False
    by_artifact: Dict[str, Dict[str, bool]] = {
        art: {"view": False, "create": False, "edit": False, "delete": False} for art in ARTIFACTS
    }

    if getattr(user, "is_admin", False):
        for art in ARTIFACTS:
            by_artifact[art] = {"view": True, "create": True, "edit": True, "delete": True}
    else:
        uid = getattr(user, "id", None)
        if uid:
            urs = session.exec(select(UserRole).where(UserRole.user_id == uid)).all()
            role_ids = [ur.role_id for ur in urs]
            if role_ids:
                rps = session.exec(select(RolePermission).where(RolePermission.role_id.in_(role_ids))).all()
                for rp in rps:
                    art = rp.artifact
                    if art not in by_artifact:
                        # In case permissions exist for an unknown artifact, include it
                        by_artifact[art] = {"view": False, "create": False, "edit": False, "delete": False}
                    by_artifact[art]["view"] = by_artifact[art]["view"] or bool(rp.can_view)
                    by_artifact[art]["create"] = by_artifact[art]["create"] or bool(rp.can_create)
                    by_artifact[art]["edit"] = by_artifact[art]["edit"] or bool(rp.can_edit)
                    by_artifact[art]["delete"] = by_artifact[art]["delete"] or bool(rp.can_delete)

    flat: Dict[str, bool] = {}
    for art, ops in by_artifact.items():
        for op, allowed in ops.items():
            flat[f"{art}:{op}"] = bool(allowed)

    return {"by_artifact": by_artifact, "flat": flat}
