import uuid
from datetime import datetime
from typing import Optional, List
from sqlalchemy import String, Text, Numeric, Integer, Boolean, DateTime, ForeignKey, func, Column, Table
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


# Association table for DyeRecipe <-> AttributeValue (multi-attribute variant matching)
dye_recipe_attribute_values = Table(
    "dye_recipe_attribute_values",
    Base.metadata,
    Column("dye_recipe_id", UUID(as_uuid=True), ForeignKey("dye_recipes.id", ondelete="CASCADE"), primary_key=True),
    Column("attribute_value_id", UUID(as_uuid=True), ForeignKey("attribute_values.id", ondelete="CASCADE"), primary_key=True),
)


class DyeRecipe(Base):
    __tablename__ = "dye_recipes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    color_standard: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    color_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("colors.id", ondelete="SET NULL"), nullable=True, index=True
    )
    substrate_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    # Litres of water per kg of substrate this recipe is written for (1:10 -> 10).
    # The recipe's own standard, because the g/L half of its lines is only weighable
    # against a bath, and the planner should not have to know the arithmetic: WO
    # creation multiplies this by the load to propose the bath. A run's own
    # `liquor_ratio` stays the pair-partner of the volume ACTUALLY filled.
    liquor_ratio: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    color = relationship("Color", foreign_keys=[color_id], back_populates="recipes")
    lines: Mapped[List["DyeRecipeLine"]] = relationship("DyeRecipeLine", back_populates="recipe", cascade="all, delete-orphan")
    wash_baths: Mapped[List["DyeRecipeWashBath"]] = relationship(
        "DyeRecipeWashBath", back_populates="recipe", cascade="all, delete-orphan",
        order_by="DyeRecipeWashBath.bath_number"
    )
    finishing_steps: Mapped[List["DyeRecipeFinishing"]] = relationship(
        "DyeRecipeFinishing", back_populates="recipe", cascade="all, delete-orphan",
        order_by="DyeRecipeFinishing.sort_order"
    )
    attribute_values = relationship("AttributeValue", secondary=dye_recipe_attribute_values)


class DyeRecipeLine(Base):
    __tablename__ = "dye_recipe_lines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipe_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("dye_recipes.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("items.id"), index=True)
    qty_per_100kg: Mapped[Optional[float]] = mapped_column(Numeric(14, 4), nullable=True)
    qty_per_liter: Mapped[Optional[float]] = mapped_column(Numeric(14, 6), nullable=True)
    uom_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("uoms.id"), nullable=True)
    chemical_type: Mapped[str] = mapped_column(String(16), default="OTHER")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    recipe: Mapped["DyeRecipe"] = relationship("DyeRecipe", back_populates="lines")
    item = relationship("Item")
    uom = relationship("UOM")


class DyeRecipeWashBath(Base):
    __tablename__ = "dye_recipe_wash_baths"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipe_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("dye_recipes.id", ondelete="CASCADE"), index=True)
    bath_number: Mapped[int] = mapped_column(Integer)
    # description is a snapshot of the picked attribute value's text (kept so print
    # views and legacy free-text rows keep rendering without a join).
    description: Mapped[str] = mapped_column(String(256))
    attribute_value_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("attribute_values.id", ondelete="SET NULL"), nullable=True, index=True
    )

    recipe: Mapped["DyeRecipe"] = relationship("DyeRecipe", back_populates="wash_baths")
    attribute_value = relationship("AttributeValue", foreign_keys=[attribute_value_id])


class DyeRecipeFinishing(Base):
    __tablename__ = "dye_recipe_finishing"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipe_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("dye_recipes.id", ondelete="CASCADE"), index=True)
    description: Mapped[str] = mapped_column(String(512))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    attribute_value_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("attribute_values.id", ondelete="SET NULL"), nullable=True, index=True
    )

    recipe: Mapped["DyeRecipe"] = relationship("DyeRecipe", back_populates="finishing_steps")
    attribute_value = relationship("AttributeValue", foreign_keys=[attribute_value_id])


class DyeingRun(Base):
    __tablename__ = "dyeing_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    work_order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("work_orders.id", ondelete="CASCADE"), index=True)
    run_number: Mapped[int] = mapped_column(Integer, default=1)
    recipe_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("dye_recipes.id", ondelete="SET NULL"), nullable=True)
    substrate_qty: Mapped[float] = mapped_column(Numeric(14, 4))
    input_batch_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("batches.id"), nullable=True)
    output_batch_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("batches.id"), nullable=True)
    # The machine this batch ran on is `work_order.work_center_id` — the WO is the
    # dispatch record, and every per-machine aggregate pegs through it (see
    # services/dyeing_monitor_service.py). A free-text `machine_name` used to sit
    # here as a display-only duplicate; dropped in a7c9e1b3d5f8, never populated.

    # --- Monitor rate inputs -------------------------------------------------
    # Rope speed for THIS batch and how many ropes it runs on. Both vary run to run
    # (a heavier cloth is run slower, a rope count is chosen per load), which is why
    # they are here and not on the work center — the same split as WeavingRun.lines
    # vs WorkCenter.beam_slots. Together they are the monitor's whole rate chain:
    # yd/min = yards_per_min * lines.
    #
    # One measured speed, not rpm x reel geometry. `yards_per_min` is per rope and
    # is PICKED, not typed freehand: the values come from the `Dyeing Speed` system
    # attribute, so the floor chooses off the same short list the vessels are
    # actually run at. Null = no efficiency reported for the run; a guessed speed
    # would read as a measurement.
    yards_per_min: Mapped[Optional[float]] = mapped_column(Numeric(10, 3), nullable=True)
    lines: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

    # The bath, dual-track, exactly like the WO's target vs actual dates:
    #   planned_volume_air_liters  the planner's number, set when the WO is cut, so
    #                              the Kartu Kerja can print weighed grams instead of
    #                              "bath not set". Never a measurement.
    #   volume_air_liters          the water the floor actually filled. This is the
    #                              one every recorded dose is weighed from, and the
    #                              one that means "this vessel is running"
    #                              (dyeing_run_service.derive_status) — which is why
    #                              a planned bath must never be written here.
    # `liquor_ratio` is the pair-partner of the ACTUAL volume (solve_bath keeps the
    # two from contradicting); the planned side's ratio lives on the recipe.
    liquor_ratio: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    planned_volume_air_liters: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    volume_air_liters: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    machine_speed: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    machine_pressure: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    # No customer / order / colour columns here. `customer_name`, `artikel`,
    # `po_number` and `qty_order_kg` restated the SO → MO → WO chain this run hangs
    # off; `color_name` and `color_matching_ref` restated the MO's colour attributes
    # and the dye recipe's own colour; `lot_number` predated the output Batch. All
    # eight were null in every one of 12 real runs — dropped in a7c9e1b3d5f8.
    temperature_c: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    duration_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="PENDING")
    shade_result: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    shade_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    operator_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # The three floor acts of a dye batch, each stamped as it happens:
    #   color_matching_at  the shade is being matched at the vessel
    #   started_at         the bath is filled and the machine is running
    #   completed_at       the bath is closed
    # The monitor reports both gaps: matching -> start is prep, start -> complete is
    # the run, and only the second is the efficiency window (a batch that sat all
    # morning waiting on a shade must not be scored as a slow machine). A run may
    # skip straight to `started_at` — the prep gap is then null, never 0, because
    # "nobody recorded it" and "it took no time" are different facts.
    color_matching_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    work_order = relationship("WorkOrder")
    recipe: Mapped[Optional["DyeRecipe"]] = relationship("DyeRecipe")
    input_batch = relationship("Batch", foreign_keys=[input_batch_id])
    output_batch = relationship("Batch", foreign_keys=[output_batch_id])
    chemicals: Mapped[List["DyeingRunChemical"]] = relationship("DyeingRunChemical", back_populates="run", cascade="all, delete-orphan")


class DyeingRunChemical(Base):
    __tablename__ = "dyeing_run_chemicals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("dyeing_runs.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("items.id"), index=True)
    planned_qty: Mapped[float] = mapped_column(Numeric(14, 4))
    actual_qty: Mapped[float] = mapped_column(Numeric(14, 4))
    uom_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("uoms.id"), nullable=True)

    run: Mapped["DyeingRun"] = relationship("DyeingRun", back_populates="chemicals")
    item = relationship("Item")
    uom = relationship("UOM")


class SettingRun(Base):
    __tablename__ = "setting_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    work_order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("work_orders.id", ondelete="CASCADE"), index=True)
    run_number: Mapped[int] = mapped_column(Integer, default=1)
    substrate_qty: Mapped[float] = mapped_column(Numeric(14, 4))
    input_batch_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("batches.id"), nullable=True)
    output_batch_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("batches.id"), nullable=True)
    machine_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    temperature_c: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    speed_mpm: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    width_cm: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    overfeed_pct: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    actual_width_cm: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    actual_gsm: Mapped[Optional[float]] = mapped_column(Numeric(8, 4), nullable=True)
    actual_shrinkage_pct: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="PENDING")
    operator_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # The three floor acts of a dye batch, each stamped as it happens:
    #   color_matching_at  the shade is being matched at the vessel
    #   started_at         the bath is filled and the machine is running
    #   completed_at       the bath is closed
    # The monitor reports both gaps: matching -> start is prep, start -> complete is
    # the run, and only the second is the efficiency window (a batch that sat all
    # morning waiting on a shade must not be scored as a slow machine). A run may
    # skip straight to `started_at` — the prep gap is then null, never 0, because
    # "nobody recorded it" and "it took no time" are different facts.
    color_matching_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    work_order = relationship("WorkOrder")
    input_batch = relationship("Batch", foreign_keys=[input_batch_id])
    output_batch = relationship("Batch", foreign_keys=[output_batch_id])
