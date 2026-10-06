from datetime import timedelta, datetime, timezone
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.db.session import get_db, SessionLocal
from app.core.ws_manager import ConnectionState
from app.core.ws_events import expand_permissions
from app.models.auth import User, Role
from app.models.audit import AuditLog
from app.schemas import UserResponse, RoleResponse, PermissionResponse, UserUpdate, UserCreate, RoleCreate, RoleUpdate
from app.core.security import verify_password, create_access_token, get_password_hash, ALGORITHM, SECRET_KEY
from jose import JWTError, jwt

router = APIRouter()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/token")

# --- Dependencies ---
def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.is_active:
        raise credentials_exception
    return user

def get_current_active_user(current_user: Annotated[User, Depends(get_current_user)]):
    return current_user

def ws_connection_state(token: str | None) -> ConnectionState | None:
    """Validate a WebSocket handshake token; return the connection's identity or None.

    The browser WebSocket API cannot set an Authorization header, so /ws/events
    takes the token in its first frame instead of through `oauth2_scheme`. This
    is the same validation `get_current_user` does — decode, load, require active
    — plus a snapshot of the effective permission codes, which the manager uses
    to decide which events this socket may receive (see core/ws_events.py).

    Sync (its own Session) and called from a threadpool: it runs once per connect,
    never on the broadcast path.

    Returns None ONLY for a genuine auth failure (missing//malformed/expired token,
    unknown or deactivated user) — the caller turns that into a 1008 close, and the
    client signs the user out on it. A database or other infrastructure failure
    propagates instead of being swallowed into None: booting a valid session
    because a query blipped would be a far worse bug than a dropped socket.
    """
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        exp = payload.get("exp")
    except JWTError:
        return None
    if not user_id:
        return None

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if user is None or not user.is_active:
            return None
        # Union of role grants and direct grants — the same two sources
        # user_has_permission() reads, flattened once instead of per check.
        codes = {p.code for p in (user.role.permissions if user.role else [])}
        codes |= {p.code for p in (user.permissions or [])}
        return ConnectionState(
            user_id=str(user.id),
            username=user.username,
            perms=expand_permissions(codes),
            expires_at=datetime.fromtimestamp(exp, tz=timezone.utc) if exp else None,
        )
    finally:
        db.close()

def role_grants(role: Role | None, code: str) -> bool:
    if not role:
        return False
    return any(p.code == 'admin.access' or p.code == code for p in role.permissions)

def user_has_permission(user: User, code: str) -> bool:
    """Effective permission = role grants (admin.access short-circuits) OR a direct grant.
    Mirrors the frontend's UserContext.hasPermission so both sides agree on access."""
    if role_grants(user.role, code):
        return True
    return any(p.code == code for p in (user.permissions or []))

def require_permission(code: str):
    """Dependency factory: 403s unless the current user's role or direct grants include `code`."""
    def _dependency(current_user: Annotated[User, Depends(get_current_user)]) -> User:
        if not user_has_permission(current_user, code):
            raise HTTPException(status_code=403, detail=f"Missing permission: {code}")
        return current_user
    return _dependency

def wo_scope_ok(user: User, center_type: str | None) -> bool:
    """Role.allowed_work_center_types restricts work_order.* actions to matching
    WorkCenter.center_type values. None list = unrestricted. No center_type context
    (e.g. an MO-level completion not tied to a WO) is never restricted."""
    allowed = user.role.allowed_work_center_types if user.role else None
    if not allowed or not center_type:
        return True
    return center_type in allowed

def category_scope_ok(user: User, category_id) -> bool:
    """Role.allowed_categories restricts item.*/stock_on_hand.* actions to matching
    Category ids. None/empty list = unrestricted. No category context is never restricted."""
    allowed = user.role.allowed_categories if user.role else None
    if not allowed or not category_id:
        return True
    return str(category_id) in allowed

def require_any_permission(*codes: str):
    """Dependency factory: 403s unless the current user has at least one of `codes`."""
    def _dependency(current_user: Annotated[User, Depends(get_current_user)]) -> User:
        if not any(user_has_permission(current_user, code) for code in codes):
            raise HTTPException(status_code=403, detail=f"Missing permission: one of {', '.join(codes)}")
        return current_user
    return _dependency

def get_current_admin(current_user: Annotated[User, Depends(get_current_user)]):
    if not user_has_permission(current_user, 'admin.access'):
        raise HTTPException(status_code=403, detail="Not authorized")
    return current_user

def _count_active_admins(db: Session, exclude_user_id: str | None = None) -> int:
    query = db.query(User).filter(User.is_active == True)
    if exclude_user_id is not None:
        query = query.filter(User.id != exclude_user_id)
    return sum(1 for u in query.all() if user_has_permission(u, 'admin.access'))

def _log_activity(db: Session, user_id, action: str, entity_id, details: str | None = None):
    db.add(AuditLog(user_id=user_id, action=action, entity_type="User", entity_id=str(entity_id), details=details))
    db.commit()

# avatar_id holds a free-form DiceBear recipe string rather than a picker index,
# so cap it at the column width instead of letting an over-long value surface as
# a 500 from the driver. The frontend is the authority on recipe contents and
# ignores anything it doesn't recognise, so there is nothing else to validate here.
def _clean_avatar_id(avatar_id: str | None) -> str | None:
    if avatar_id is None:
        return None
    trimmed = avatar_id.strip()[:255]
    return trimmed or None

# --- Endpoints ---

@router.post("/token")
def login_for_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password) or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()

    access_token = create_access_token(subject=user.id)
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/users/me", response_model=UserResponse)
def read_users_me(current_user: Annotated[User, Depends(get_current_active_user)]):
    return current_user

@router.get("/users", response_model=list[UserResponse])
def get_users(db: Session = Depends(get_db), current_user: User = Depends(get_current_admin)):
    return db.query(User).all()

@router.get("/roles", response_model=list[RoleResponse])
def get_roles(db: Session = Depends(get_db), current_user: User = Depends(get_current_admin)):
    return db.query(Role).all()

@router.get("/permissions", response_model=list[PermissionResponse])
def get_permissions(db: Session = Depends(get_db), current_user: User = Depends(get_current_admin)):
    from app.models.auth import Permission
    return db.query(Permission).all()

@router.post("/roles", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
def create_role(payload: RoleCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_admin)):
    if db.query(Role).filter(Role.name == payload.name).first():
        raise HTTPException(status_code=400, detail="Role name already taken")

    from app.models.auth import Permission
    perms = db.query(Permission).filter(Permission.id.in_(payload.permission_ids)).all() if payload.permission_ids else []

    role = Role(
        name=payload.name, description=payload.description, permissions=perms,
        allowed_work_center_types=payload.allowed_work_center_types,
        allowed_categories=payload.allowed_categories,
        allowed_locations=payload.allowed_locations,
        default_avatar_id=_clean_avatar_id(payload.default_avatar_id),
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    _log_activity(db, current_user.id, "CREATE", role.id, details=f"Created role {role.name}")
    return role

@router.put("/roles/{role_id}", response_model=RoleResponse)
def update_role(role_id: str, payload: RoleUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_admin)):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    if payload.name is not None and payload.name != role.name:
        if db.query(Role).filter(Role.name == payload.name).first():
            raise HTTPException(status_code=400, detail="Role name already taken")
        role.name = payload.name

    if payload.description is not None:
        role.description = payload.description

    if payload.permission_ids is not None:
        from app.models.auth import Permission
        role.permissions = db.query(Permission).filter(Permission.id.in_(payload.permission_ids)).all()

    if payload.allowed_work_center_types is not None:
        role.allowed_work_center_types = payload.allowed_work_center_types or None

    if payload.allowed_categories is not None:
        role.allowed_categories = payload.allowed_categories or None

    if payload.allowed_locations is not None:
        role.allowed_locations = payload.allowed_locations or None

    if payload.default_avatar_id is not None:
        # `_clean_avatar_id` maps "" to None, which is how the form clears the
        # template rather than storing an empty recipe nothing can parse.
        role.default_avatar_id = _clean_avatar_id(payload.default_avatar_id)

    db.commit()
    db.refresh(role)
    _log_activity(db, current_user.id, "UPDATE", role.id, details=f"Updated role {role.name}")
    return role

@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(role_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_admin)):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    in_use = db.query(User).filter(User.role_id == role.id).count()
    if in_use:
        raise HTTPException(status_code=400, detail=f"Role is assigned to {in_use} user(s); reassign them before deleting")

    role_name = role.name
    db.delete(role)
    db.commit()
    _log_activity(db, current_user.id, "DELETE", role_id, details=f"Deleted role {role_name}")

@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_admin)):
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")

    role = None
    if payload.role_id is not None:
        role = db.query(Role).filter(Role.id == payload.role_id).first()
        if not role:
            raise HTTPException(status_code=400, detail="Role not found")

    from app.models.auth import Permission
    perms = db.query(Permission).filter(Permission.id.in_(payload.permission_ids)).all() if payload.permission_ids else []

    user = User(
        username=payload.username,
        full_name=payload.full_name,
        hashed_password=get_password_hash(payload.password),
        role_id=role.id if role else None,
        permissions=perms,
        avatar_id=_clean_avatar_id(payload.avatar_id),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    _log_activity(db, current_user.id, "CREATE", user.id, details=f"Created user {user.username}")
    return user

@router.put("/users/{user_id}", response_model=UserResponse)
def update_user(user_id: str, payload: UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    is_self = str(current_user.id) == str(user_id)
    is_admin = user_has_permission(current_user, 'admin.access')

    if not is_self and not is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Only admins may change role or granular permissions
    if not is_admin and (payload.role_id is not None or payload.permission_ids is not None):
        raise HTTPException(status_code=403, detail="Not authorized")

    if payload.username is not None and payload.username != user.username:
        # Check if username exists
        if db.query(User).filter(User.username == payload.username).first():
            raise HTTPException(status_code=400, detail="Username already taken")
        user.username = payload.username

    if payload.full_name is not None:
        user.full_name = payload.full_name

    if payload.role_id is not None:
        role = db.query(Role).filter(Role.id == payload.role_id).first()
        if not role:
            raise HTTPException(status_code=400, detail="Role not found")
        was_admin = user_has_permission(user, 'admin.access')
        new_role_is_admin = role_grants(role, 'admin.access')
        if was_admin and not new_role_is_admin and _count_active_admins(db, exclude_user_id=user.id) < 1:
            raise HTTPException(status_code=400, detail="Cannot remove the last active Administrator")
        user.role_id = role.id

    if payload.password is not None:
        user.hashed_password = get_password_hash(payload.password)

    if payload.permission_ids is not None:
        from app.models.auth import Permission
        perms = db.query(Permission).filter(Permission.id.in_(payload.permission_ids)).all()
        user.permissions = perms

    if payload.avatar_id is not None:
        user.avatar_id = _clean_avatar_id(payload.avatar_id)

    db.commit()
    db.refresh(user)
    _log_activity(db, current_user.id, "UPDATE", user.id, details=f"Updated user {user.username}")
    return user

@router.post("/users/{user_id}/deactivate", response_model=UserResponse)
def deactivate_user(user_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if str(current_user.id) == str(user_id):
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")

    if user_has_permission(user, 'admin.access') and _count_active_admins(db, exclude_user_id=user.id) < 1:
        raise HTTPException(status_code=400, detail="Cannot deactivate the last active Administrator")

    user.is_active = False
    db.commit()
    db.refresh(user)
    _log_activity(db, current_user.id, "DEACTIVATE", user.id, details=f"Deactivated user {user.username}")
    return user

@router.post("/users/{user_id}/reactivate", response_model=UserResponse)
def reactivate_user(user_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_active = True
    db.commit()
    db.refresh(user)
    _log_activity(db, current_user.id, "REACTIVATE", user.id, details=f"Reactivated user {user.username}")
    return user