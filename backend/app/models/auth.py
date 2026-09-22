import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Table, Column, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base

# Association table for Role <-> Permission
role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", UUID(as_uuid=True), ForeignKey("roles.id"), primary_key=True),
    Column("permission_id", UUID(as_uuid=True), ForeignKey("permissions.id"), primary_key=True),
)

# Association table for User <-> Permission (Granular access)
user_permissions = Table(
    "user_permissions",
    Base.metadata,
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True),
    Column("permission_id", UUID(as_uuid=True), ForeignKey("permissions.id"), primary_key=True),
)

class Permission(Base):
    __tablename__ = "permissions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True) # e.g. "inventory.item.create"
    description: Mapped[str] = mapped_column(String(255))

class Role(Base):
    __tablename__ = "roles"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True) # e.g. "Manager"
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Work-center-type restriction for work_order.* actions (If Null, allow all types).
    allowed_work_center_types: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    # Category-id restriction for item.*/stock_on_hand.* actions (If Null, allow all categories).
    allowed_categories: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    # Location-id restriction for lot.* actions (If Null, allow all locations).
    allowed_locations: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    # Default avatar TEMPLATE for users in this role: a DiceBear recipe (same
    # format as User.avatar_id) whose *pinned slots* apply to any user in the role
    # who hasn't saved an avatar of their own. The template's own seed is ignored
    # — each user still seeds from their username — so a role sets a dress code
    # (no party hat on a director) without giving everyone in it the same face.
    # Null = no constraint; the user's seed decides every slot, as before.
    default_avatar_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    permissions = relationship("Permission", secondary=role_permissions)

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(128))
    hashed_password: Mapped[str] = mapped_column(String(255)) # New field for security
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    role_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("roles.id"), nullable=True
    )

    # Holds a versioned DiceBear recipe (see frontend avatarRecipe.ts), e.g.
    # "v1|bryan|ht:variant03|sk:8d5524" — a seed plus per-slot overrides, not an
    # index into a fixed sprite list. Legacy '1'..'10' values from the old
    # hand-drawn sprites are inert: the frontend falls back to seeding from the
    # username when the stored value isn't a "v1|" recipe.
    avatar_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    role = relationship("Role")
    permissions = relationship("Permission", secondary=user_permissions)
    bom_automator_profiles = relationship("BOMAutomatorProfile", back_populates="user", cascade="all, delete-orphan")
    preferences = relationship("UserPreference", back_populates="user", cascade="all, delete-orphan")


class BOMAutomatorProfile(Base):
    __tablename__ = "bom_automator_profiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    levels: Mapped[list] = mapped_column(JSON, nullable=False)
    # Per-level "inherit the root BOM's attribute values" flags, parallel to `levels`.
    # Nullable: profiles saved before this existed have no flags and default to False
    # (no inheritance), so an old profile never silently stamps a Combo onto children.
    inherit_attributes: Mapped[list | None] = mapped_column(JSON, nullable=True)

    user = relationship("User", back_populates="bom_automator_profiles")


class UserPreference(Base):
    __tablename__ = "user_preferences"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_user_preferences_user_id_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    value: Mapped[dict] = mapped_column(JSON, nullable=False)

    user = relationship("User", back_populates="preferences")
