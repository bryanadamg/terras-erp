from pydantic import BaseModel
from pydantic import ConfigDict
from uuid import UUID
from datetime import datetime, date
from typing import Optional, Any

class VariantCreate(BaseModel):
    name: str
    category: str | None = None

class VariantResponse(VariantCreate):
    id: UUID
    item_id: UUID

    class Config:
        from_attributes = True

class AttributeValueCreate(BaseModel):
    value: str
    hex: Optional[str] = None

class AttributeValueUpdate(BaseModel):
    value: str
    hex: Optional[str] = None

class AttributeValueResponse(AttributeValueCreate):
    id: UUID
    attribute_id: UUID

    class Config:
        from_attributes = True

class AttributeCreate(BaseModel):
    name: str
    values: list[AttributeValueCreate] = []

class AttributeUpdate(BaseModel):
    name: str

class AttributeResponse(AttributeCreate):
    id: UUID
    is_system: bool = False
    system_role: str | None = None
    values: list[AttributeValueResponse] = []

    class Config:
        from_attributes = True

class SizeResponse(BaseModel):
    id: UUID
    name: str
    sort_order: int

    class Config:
        from_attributes = True

class BOMSizeCreate(BaseModel):
    size_id: UUID | None = None
    label: str | None = None
    target_measurement: float | None = None
    measurement_min: float | None = None
    measurement_max: float | None = None

class BOMSizeResponse(BaseModel):
    id: UUID
    size_id: UUID | None = None
    label: str | None = None
    size_name: str | None = None
    target_measurement: float | None = None
    measurement_min: float | None = None
    measurement_max: float | None = None
    sort_order: int = 0

    class Config:
        from_attributes = True

class BOMLineCreate(BaseModel):
    item_code: str
    attribute_value_ids: list[UUID] = []
    qty: float = 0.0
    percentage: float = 0.0
    source_location_code: str | None = None
    bom_operation_sequence: Optional[int] = None
    is_decoupling_point: bool | None = None  # null = inherit item-master default

class BOMLineResponse(BaseModel):
    id: UUID
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    attribute_value_ids: list[UUID] = [] # We'll populate this in the API
    qty: float
    percentage: float = 0.0
    source_location_id: UUID | None = None
    bom_operation_id: UUID | None = None
    is_decoupling_point: bool | None = None

    class Config:
        from_attributes = True

class BOMOperationCreate(BaseModel):
    operation_id: Optional[UUID] = None
    work_center_id: Optional[UUID] = None
    sequence: int = 10
    time_minutes: float = 0.0

class BOMOperationResponse(BaseModel):
    id: UUID
    operation_id: Optional[UUID] = None
    work_center_id: Optional[UUID] = None
    sequence: int
    time_minutes: float
    operation_name: Optional[str] = None
    work_center_type: Optional[str] = None

    class Config:
        from_attributes = True

    @classmethod
    def model_validate(cls, obj, **kwargs):
        instance = super().model_validate(obj, **kwargs)
        if hasattr(obj, 'operation') and obj.operation:
            instance.operation_name = obj.operation.name
        if hasattr(obj, 'work_center') and obj.work_center:
            instance.work_center_type = obj.work_center.center_type
        return instance

class BOMItemLookupRequest(BaseModel):
    """Item codes whose existing BOM the designer needs to know about."""
    item_codes: list[str]


class BOMItemLookupEntry(BaseModel):
    item_code: str
    bom_id: UUID
    bom_code: str
    attribute_value_ids: list[UUID] = []


class BOMItemLookupResponse(BaseModel):
    matches: list[BOMItemLookupEntry]


class BOMCodeResolveRequest(BaseModel):
    """Desired BOM codes for a tree about to be saved, in save order."""
    codes: list[str]


class BOMCodeResolveResponse(BaseModel):
    # desired code -> free code (identical when the desired code was already free)
    resolved: dict[str, str]


class BOMCreate(BaseModel):
    code: str
    description: str | None = None
    item_code: str
    attribute_value_ids: list[UUID] = []
    qty: float = 1.0
    tolerance_percentage: float = 0.0          # input side: material wastage
    overdelivery_tolerance_percentage: float = 10.0   # output side: how far past MO qty may be logged
    size_mode: str = 'sized'
    lines: list[BOMLineCreate]
    operations: list[BOMOperationCreate] = []
    sizes: list[BOMSizeCreate] = []
    kerapatan_picks: float | None = None
    kerapatan_unit: str | None = None
    sisir_no: int | None = None
    pemakaian_obat: str | None = None
    pembuatan_sample_oleh: str | None = None
    sample_photo_url: str | None = None
    design_file_url: str | None = None
    customer_id: Optional[UUID] = None
    work_center_id: Optional[UUID] = None
    berat_bahan_mateng: float | None = None
    berat_bahan_mentah_pelesan: float | None = None
    mesin_lebar: float | None = None
    mesin_panjang_tulisan: float | None = None
    mesin_panjang_tarikan: float | None = None
    mesin_panjang_tarikan_bandul_1kg: float | None = None
    mesin_panjang_tarikan_bandul_9kg: float | None = None
    celup_lebar: float | None = None
    celup_panjang_tulisan: float | None = None
    celup_panjang_tarikan: float | None = None
    celup_panjang_tarikan_bandul_1kg: float | None = None
    celup_panjang_tarikan_bandul_9kg: float | None = None

class BOMResponse(BaseModel):
    id: UUID
    code: str
    description: str | None
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    attribute_value_ids: list[UUID] = [] # We'll populate this in the API
    qty: float
    tolerance_percentage: float = 0.0
    overdelivery_tolerance_percentage: float = 10.0
    size_mode: str = 'sized'
    active: bool
    lines: list[BOMLineResponse]
    operations: list[BOMOperationResponse] = []
    sizes: list[BOMSizeResponse] = []
    kerapatan_picks: float | None = None
    kerapatan_unit: str | None = None
    sisir_no: int | None = None
    pemakaian_obat: str | None = None
    pembuatan_sample_oleh: str | None = None
    sample_photo_url: str | None = None
    design_file_url: str | None = None
    customer_id: Optional[UUID] = None
    customer_name: Optional[str] = None
    work_center_id: Optional[UUID] = None
    work_center_name: Optional[str] = None
    work_center_type: Optional[str] = None
    berat_bahan_mateng: float | None = None
    berat_bahan_mentah_pelesan: float | None = None
    mesin_lebar: float | None = None
    mesin_panjang_tulisan: float | None = None
    mesin_panjang_tarikan: float | None = None
    mesin_panjang_tarikan_bandul_1kg: float | None = None
    mesin_panjang_tarikan_bandul_9kg: float | None = None
    celup_lebar: float | None = None
    celup_panjang_tulisan: float | None = None
    celup_panjang_tarikan: float | None = None
    celup_panjang_tarikan_bandul_1kg: float | None = None
    celup_panjang_tarikan_bandul_9kg: float | None = None

    class Config:
        from_attributes = True

class BOMLookupResponse(BaseModel):
    """Slim BOM shape for consumers that .find()/.filter() by (item_id,
    attribute_value_ids) or need the size dropdown — never routing/materials.
    Mirrors the /items + /items/lookup split. See GET /boms/lookup."""
    id: UUID
    code: str
    description: str | None
    item_id: UUID
    attribute_value_ids: list[UUID] = []
    active: bool
    size_mode: str = 'sized'
    sizes: list[BOMSizeResponse] = []

    class Config:
        from_attributes = True

class BOMSummaryResponse(BaseModel):
    """Lightweight BOM list payload for the BOM page. Identical to BOMResponse
    except `operations` (an array) is collapsed to `operation_count` — the list
    only shows an op count, never the routing rows. Line/size shapes are
    unchanged so every consumer reads the same fields."""
    is_root: bool = True  # True if item_id not used as a component in any other BOM
    id: UUID
    code: str
    description: str | None
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    attribute_value_ids: list[UUID] = []
    qty: float
    tolerance_percentage: float = 0.0
    overdelivery_tolerance_percentage: float = 10.0
    size_mode: str = 'sized'
    active: bool
    lines: list[BOMLineResponse]
    operation_count: int = 0
    sizes: list[BOMSizeResponse] = []
    kerapatan_picks: float | None = None
    kerapatan_unit: str | None = None
    sisir_no: int | None = None
    pemakaian_obat: str | None = None
    pembuatan_sample_oleh: str | None = None
    sample_photo_url: str | None = None
    design_file_url: str | None = None
    customer_id: Optional[UUID] = None
    customer_name: Optional[str] = None
    work_center_id: Optional[UUID] = None
    work_center_name: Optional[str] = None
    work_center_type: Optional[str] = None
    berat_bahan_mateng: float | None = None
    berat_bahan_mentah_pelesan: float | None = None
    mesin_lebar: float | None = None
    mesin_panjang_tulisan: float | None = None
    mesin_panjang_tarikan: float | None = None
    mesin_panjang_tarikan_bandul_1kg: float | None = None
    mesin_panjang_tarikan_bandul_9kg: float | None = None
    celup_lebar: float | None = None
    celup_panjang_tulisan: float | None = None
    celup_panjang_tarikan: float | None = None
    celup_panjang_tarikan_bandul_1kg: float | None = None
    celup_panjang_tarikan_bandul_9kg: float | None = None

    class Config:
        from_attributes = True

class BOMSummaryPageResponse(BaseModel):
    items: list[BOMSummaryResponse]
    total: int
    page: int = 1
    size: int = 50

class BOMLineTreeResponse(BOMLineResponse):
    sub_bom: Optional["BOMTreeResponse"] = None

    class Config:
        from_attributes = True

class BOMTreeResponse(BOMResponse):
    lines: list[BOMLineTreeResponse] = []

    class Config:
        from_attributes = True

BOMLineTreeResponse.model_rebuild()
BOMTreeResponse.model_rebuild()

class BOMUpdate(BaseModel):
    description: str | None = None
    qty: float | None = None
    tolerance_percentage: float | None = None
    overdelivery_tolerance_percentage: float | None = None
    active: bool | None = None
    size_mode: str | None = None
    attribute_value_ids: list[UUID] | None = None
    lines: list[BOMLineCreate] | None = None
    operations: list[BOMOperationCreate] | None = None
    sizes: list[BOMSizeCreate] | None = None
    customer_id: Optional[UUID] = None
    work_center_id: Optional[UUID] = None
    kerapatan_picks: float | None = None
    kerapatan_unit: str | None = None
    sisir_no: int | None = None
    pemakaian_obat: str | None = None
    pembuatan_sample_oleh: str | None = None
    berat_bahan_mateng: float | None = None
    berat_bahan_mentah_pelesan: float | None = None
    mesin_lebar: float | None = None
    mesin_panjang_tulisan: float | None = None
    mesin_panjang_tarikan: float | None = None
    mesin_panjang_tarikan_bandul_1kg: float | None = None
    mesin_panjang_tarikan_bandul_9kg: float | None = None
    celup_lebar: float | None = None
    celup_panjang_tulisan: float | None = None
    celup_panjang_tarikan: float | None = None
    celup_panjang_tarikan_bandul_1kg: float | None = None
    celup_panjang_tarikan_bandul_9kg: float | None = None


class MOCompletionItemCreate(BaseModel):
    item_id: UUID
    qty_used: float

class MOCompletionItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    qty_used: float

class ConsumedLot(BaseModel):
    batch_id: UUID
    qty: float                          # amount consumed from this specific lot

class MOCompletionCreate(BaseModel):
    qty_completed: float
    qty_cones: int | None = None   # optional output packaging tally
    qty_boxes: int | None = None
    operator_name: str | None = None
    notes: str | None = None
    work_center_id: UUID | None = None
    work_order_id: UUID | None = None
    actual_items: list[MOCompletionItemCreate] = []
    beam_number: str | None = None      # lot-tracked/beam output: batch number (blank = auto-generate)
    beam_batch_id: UUID | None = None   # legacy single input batch (kept for compat)
    consumed_batches: list[UUID] = []   # input batches to consume from, matched to lines by item (single lot per item)
    consumed_lots: list[ConsumedLot] = []   # multi-lot input consumption with explicit per-lot qty (dyeing greige substrate);
                                             # authoritatively deducts these lots and overrides the BOM% deduction for their items
    output_location_id: UUID | None = None  # putaway override: books output here instead of the WO's output location

class MOCompletionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    mo_id: UUID
    work_order_id: UUID | None = None
    qty_completed: float
    qty_cones: int | None = None
    qty_boxes: int | None = None
    operator_name: str | None = None
    notes: str | None = None
    work_center_id: UUID | None = None
    work_center_name: str | None = None
    actual_items: list[MOCompletionItemResponse] = []
    created_at: datetime
    output_batch_id: UUID | None = None
    output_batch_number: str | None = None
    output_batch_notes: str | None = None  # clean operator note stamped on the lot (see model property)
    rejected: bool = False
    qty_rejected: float = 0.0   # scrapped out of this log entry (partial or whole)
    reject_reason: str | None = None
    rejected_at: datetime | None = None
    rejected_by: str | None = None
    # Defect store the scrap was quarantined into (null = written off / left in place)
    reject_location_id: UUID | None = None

class BatchReject(BaseModel):
    """QC-reject a produced lot (from the Lot Management page)."""
    reason: str | None = None
    # Partial reject: kg to reject. None or >= remaining = reject the whole lot
    # (flag it REJECTED). A value below remaining splits off a REJECTED sub-lot
    # for that qty and leaves the balance GOOD/active.
    qty: float | None = None
    # Defect store to move the rejected stock into. Rejected goods stay physically
    # on-hand until disposed, so quarantining them in a separate location is what
    # keeps them off the good-stock shelf. Omit to let reject_service resolve it
    # from the producing work center (inherited down the WC tree) or the item
    # master default; only a lot with no routing at all stays where it is.
    location_id: UUID | None = None
    # Downgrade instead of scrap: quarantined and out of availability, but still
    # selectable for consumption (a rejected warp beam re-mounts on some items).
    usable: bool = False

class BatchSplit(BaseModel):
    """Split a GOOD lot: move `qty` off into a new GOOD sub-lot (same item,
    location, variant), leaving the original with the remainder. Used to peel a
    leftover off a bag when only part of it is staged/consumed."""
    qty: float
    reason: str | None = None


class BatchDispose(BaseModel):
    """Dispose/scrap a REJECTED lot: physically write off its remaining stock
    (posts it OUT of every balance row) and mark the lot DISPOSED. Irreversible."""
    reason: str | None = None


class BatchReassign(BaseModel):
    """Recycle a rejected lot into a different item instead of scrapping it: the
    physical goods are fine for another product (a rejected warp beam re-warped
    for a coarser cloth), so the stock moves to a new GOOD lot under `item_id`
    rather than being written off."""
    item_id: UUID
    # Partial recycle: qty to move. None or >= remaining moves the whole balance,
    # which leaves the rejected lot depleted; a smaller value leaves the rest on
    # the rejected lot for a later dispose.
    qty: float | None = None
    # Where the recycled stock lands. Omit to leave it in whichever bin each
    # source balance row sits in (usually the defect store).
    location_id: UUID | None = None
    reason: str | None = None

class MOCompletionReject(BaseModel):
    """Completion-level reject (API/un-lotted outputs; lot page uses /batches/{id}/reject)."""
    reason: str | None = None
    # Legacy completions (pre output_batch_id link) can name the lot explicitly
    output_batch_id: UUID | None = None
    # Defect store override. Omit to let reject_service resolve it: work center's
    # reject location (inherited down the WC tree) → item master default.
    reject_location_id: UUID | None = None
    # Downgrade instead of scrap: the lot is quarantined and drops out of
    # availability, but stays selectable for consumption (a rejected warp beam can
    # be re-mounted for some items). Stores quality_status=REJECT_USABLE.
    usable: bool = False

class ManufacturingOrderCreate(BaseModel):
    code: str
    bom_id: UUID
    location_code: str | None = None
    source_location_code: str | None = None
    sales_order_id: UUID | None = None
    qty: float
    production_run_id: UUID | None = None
    bom_size_id: UUID | None = None
    target_start_date: datetime | None = None
    target_end_date: datetime | None = None
    create_nested: bool = False # Prompt user to create child MOs

class MOAttributeUpdate(BaseModel):
    attribute_value_ids: list[UUID]

class MOColorUpdate(BaseModel):
    color_id: UUID | None = None  # approved Color Library shade; null clears it

class MOPutawayUpdate(BaseModel):
    location_id: UUID | None = None   # null clears the planned putaway bin

class MOToleranceUpdate(BaseModel):
    """Per-order overdelivery override. Null pct = fall back to the BOM default."""
    overdelivery_tolerance_pct: float | None = None
    allow_unlimited_overdelivery: bool | None = None

class BatchConsumptionInMO(BaseModel):
    input_batch_id: UUID
    input_batch_number: str
    output_batch_id: Optional[UUID] = None
    output_batch_number: Optional[str] = None
    qty_consumed: float

class MOPlannedComponentResponse(BaseModel):
    """One BOM line as it stood when the MO was cut.

    The MO panel has to render THIS, not the live BOM: a BOM edited after the order
    was created would otherwise retroactively change what an in-flight MO appears
    to demand, and disagree with the server's own availability flag on the same row.
    `item_code`/`item_name` are stamped by populate_mo_ids rather than read off the
    relationship — most callers load planned_components without its `item`, and a
    lazy hop in an async route raises MissingGreenlet.
    """
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    percentage: float = 0.0
    qty: float = 0.0
    source_location_id: UUID | None = None
    bom_line_id: UUID | None = None
    bom_operation_id: UUID | None = None   # the routing step that consumes it, if pegged
    attribute_value_ids: list[UUID] = []


class ManufacturingOrderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    bom_id: UUID
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    item_ends: int | None = None  # beam warp-ends (utas); authoritative default for beam WO planning
    sales_order_id: UUID | None = None
    sales_order_code: str | None = None
    parent_mo_id: UUID | None = None
    production_run_id: UUID | None = None
    bom_size_id: UUID | None = None
    bom_size_snapshot: dict | None = None
    is_shared_component: bool = False
    attribute_value_ids: list[UUID] = []
    color_id: UUID | None = None
    color_code: str | None = None
    color_name: str | None = None
    labdip_variant_code: str | None = None
    labdip_status: str | None = None  # pending shade's lab dip status (PENDING/IN_PROGRESS/APPROVED/REJECTED)
    location_id: UUID | None = None
    source_location_id: UUID | None = None
    planned_putaway_location_id: UUID | None = None
    planned_putaway_location_name: str | None = None
    qty: float
    status: str
    # Output overdelivery allowance. Null on legacy rows — treat as the 10% default.
    overdelivery_tolerance_pct: float | None = None
    allow_unlimited_overdelivery: bool = False
    target_start_date: datetime | None
    target_end_date: datetime | None
    actual_start_date: datetime | None
    actual_end_date: datetime | None
    created_at: datetime
    card_printed_at: datetime | None = None
    is_material_available: bool = True
    qty_completed_total: float = 0.0
    # Scrapped output across this MO's completions — yield = good / (good + rejected)
    qty_rejected_total: float = 0.0
    required_mo_ids: list[UUID] = []  # IDs of shared component MOs this MO depends on (populated in API)

    bom: Optional[BOMResponse] = None
    child_mos: list['ManufacturingOrderResponse'] = []
    work_orders: list['WorkOrderResponse'] = []
    batch_trace: list[BatchConsumptionInMO] = []
    completions: list[MOCompletionResponse] = []
    # BOM lines snapshotted at creation — what this order is actually cut against.
    planned_components: list[MOPlannedComponentResponse] = []

# Forward refs resolved after WorkOrderResponse is defined below

class PaginatedManufacturingOrderResponse(BaseModel):
    items: list[ManufacturingOrderResponse]
    total: int
    page: int
    size: int

# --- Production Run Schemas ---

class PRBomSizeEntry(BaseModel):
    bom_size_id: UUID
    qty: float

class PRBomEntryCreate(BaseModel):
    bom_id: UUID
    sizes: list[PRBomSizeEntry] = []
    total_qty: float | None = None
    attribute_value_ids: list[UUID] = []
    color_id: UUID | None = None
    labdip_variant_code: str | None = None
    force_create: bool = False

class PRBomEntrySizeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    bom_size_id: UUID
    qty: float

class PRBomEntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    bom_id: UUID
    total_qty: float | None = None
    attribute_value_ids: list[UUID] = []
    color_id: UUID | None = None
    labdip_variant_code: str | None = None
    force_create: bool = False
    bom: Optional['BOMResponse'] = None
    sizes: list[PRBomEntrySizeResponse] = []

# Kept for backward compatibility (used by SO-page deep-link flow)
class ProductionRunSizeEntry(BaseModel):
    bom_size_id: UUID
    qty: float

class ProductionRunCreate(BaseModel):
    code: str
    bom_entries: list[PRBomEntryCreate]
    location_code: str | None = None
    source_location_code: str | None = None
    sales_order_id: UUID | None = None
    target_start_date: datetime | None = None
    target_end_date: datetime | None = None
    notes: str | None = None

class ProductionRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    bom_id: UUID | None = None
    sales_order_id: UUID | None = None
    sales_order_code: str | None = None
    location_id: UUID | None = None
    source_location_id: UUID | None = None
    status: str
    notes: str | None = None
    target_start_date: datetime | None = None
    target_end_date: datetime | None = None
    actual_start_date: datetime | None = None
    actual_end_date: datetime | None = None
    created_at: datetime
    bom: Optional['BOMResponse'] = None
    bom_entries: list[PRBomEntryResponse] = []
    manufacturing_orders: list['ManufacturingOrderResponse'] = []

class PaginatedProductionRunResponse(BaseModel):
    items: list[ProductionRunResponse]
    total: int
    page: int
    size: int

class PRMOContribution(BaseModel):
    mo_id: UUID
    mo_code: str
    mo_qty: float
    required_qty: float             # NET (outstanding-based) — what this MO has still to consume
    gross_required_qty: float = 0.0  # full-order basis, for reference
    mo_outstanding_qty: float = 0.0  # mo.qty - good completions (0 once closed)

class PRProductionMO(BaseModel):
    """One of this PR's MOs that PRODUCES the component — its logged output so far.

    Lets the PR panel answer "has this component actually been made yet?" without
    opening each MO: qty_produced is good (non-rejected) logged output."""
    mo_id: UUID
    mo_code: str
    mo_qty: float                   # order target
    qty_produced: float             # good logged output so far
    wo_count: int = 0               # work orders opened on this MO (0 = nothing dispatched yet)
    status: str                     # NOT_STARTED | SHORT | OK  (vs this MO's own qty)

class PRMaterialLot(BaseModel):
    """One lot behind a component's on-hand figure. Non-lotted stock contributes
    no rows, so an empty list means "on hand, but not lot-tracked" — not "none"."""
    batch_id: str | None = None
    batch_number: str | None = None
    qty: float = 0
    location_name: str | None = None


class PRMaterialRequirementItem(BaseModel):
    item_id: UUID
    item_code: str
    item_name: str
    uom: str
    # Warp ends (utas) from the item master — beam items only, null everywhere else.
    # Item.ends is one of the three arms of beam_service.beam_item_ids(), so a
    # non-null value is itself the "this line is a beam" signal on the pull sheet.
    ends: int | None = None
    attribute_value_ids: list[UUID]
    # Size bucket this requirement nets in — null = the unsized/generic pool. Netting
    # is size-aware, so a sized component yields one row per size and the rows are
    # only distinguishable by this.
    size_label: str | None = None
    location_id: UUID | None = None        # item's default source location (pull-sheet hint only — netting itself is plant-wide/location-agnostic)
    total_required: float                  # NET requirement: scaled by each MO's OUTSTANDING output
    gross_required: float = 0.0            # requirement at full order qty (never decrements)
    qty_available: float                   # physical on-hand, plant-wide, good stock only
    # Outstanding demand for this component from every OTHER open order, read off the
    # shared Booking Stock netting. qty_available alone promises the same greige to
    # every run that needs it; qty_free is what this run can actually count on.
    qty_claimed_elsewhere: float = 0.0
    qty_free: float = 0.0                  # max(0, qty_available - qty_claimed_elsewhere)
    lots: list['PRMaterialLot'] = []       # lots behind qty_available (empty = not lot-tracked)
    qty_incoming: float = 0.0              # outstanding output of this PR's own MOs that produce the item
    shortfall: float                       # max(0, total_required - qty_available - qty_incoming) — MATERIAL blocker
    qty_produced: float = 0.0              # good output logged by this PR's MOs producing the item
    production_shortfall: float = 0.0      # max(0, gross_required - qty_produced); 0 when nothing here produces it
    # Single row verdict, driven by progress and escalated by material. Precedence:
    # SHORT (material genuinely missing — nothing on hand, nothing scheduled) beats
    # everything; then DONE (made in full) / IN_PROGRESS (output logged, not finished) /
    # NOT_STARTED (WO opened, nothing logged) / NO_WO (no work order opened yet — a
    # dispatch decision, since WOs are created manually) / SUPPLIED (not produced here).
    status: str = "SUPPLIED"               # SHORT | IN_PROGRESS | DONE | NOT_STARTED | NO_WO | SUPPLIED
    mo_contributions: list[PRMOContribution]
    supply_mos: list['BookingSupplyMO'] = []
    production_mos: list[PRProductionMO] = []

# ── Booking Stock (material availability across all ongoing MOs) ──────────────
class BookingDemandMO(BaseModel):
    """One ongoing MO's outstanding demand for a component item."""
    mo_id: UUID
    mo_code: str
    mo_qty: float
    required_qty: float

class BookingSupplyMO(BaseModel):
    """One ongoing MO whose outstanding output will supply (produce) this item."""
    mo_id: UUID
    mo_code: str
    mo_qty: float
    incoming_qty: float

class BookingReservedSO(BaseModel):
    """One sales order holding part of this row's on-hand — see stock_reservations."""
    sales_order_id: UUID
    so_number: str = ""
    reserved_qty: float


class BookingStockRow(BaseModel):
    item_id: UUID
    item_code: str
    item_name: str
    uom: str
    attribute_value_ids: list[UUID]
    # Size bucket this row nets in — null = the unsized/generic pool. Netting is
    # size-aware (an M roll is not XL stock), so one item+variant can produce
    # several rows and they must be told apart on screen.
    size_label: str | None = None
    location_id: UUID | None = None        # null = plant-wide (location-agnostic netting)
    location_name: str = "Plant-wide"
    qty_on_hand: float       # current physical balance
    qty_required: float      # outstanding demand from ongoing MOs
    qty_incoming: float       # scheduled receipts from in-flight production MOs
    qty_reserved: float = 0.0 # on-hand promised to open sales orders (stock_reservations)
    qty_net_free: float      # on_hand + incoming - required - reserved  (negative = shortfall)
    demand_mos: list[BookingDemandMO]
    supply_mos: list[BookingSupplyMO]
    reserved_sos: list[BookingReservedSO] = []

class PaginatedBookingStockResponse(BaseModel):
    items: list[BookingStockRow]
    total: int
    page: int
    size: int

# PRMaterialRequirementItem.supply_mos forward-references BookingSupplyMO, declared above.
PRMaterialRequirementItem.model_rebuild()

# ── Creation netting preview (dry-run; shows where each component nets from) ───
class NettingPreviewChip(BaseModel):
    """Row-identity tag on a preview node. Several rows can share an item name
    (same recipe, different size or shade), so the chips are what tells them
    apart. `kind`: size | color | combo | attr."""
    kind: str
    label: str
    hex: str | None = None
    group: str | None = None            # source attribute / label group

class NettingPreviewNode(BaseModel):
    """One node in the dry-run explosion of a PR/MO about to be created.

    Root nodes (is_root=True) are the finished goods — always produced at full
    qty (decision MAKE_ROOT), no netting. Component nodes carry the net-free
    breakdown and the resolved location the net was calculated FROM."""
    level: int                          # 0 = root FG, 1 = direct component, ...
    is_root: bool
    item_id: UUID
    item_code: str
    item_name: str
    uom: str
    net_from_location_id: UUID | None = None
    net_from_location_name: str
    gross_required: float               # qty x percentage / 100 (no netting)
    on_hand: float                      # leaf-rolled physical stock at the location
    incoming: float                     # other open MOs' scheduled output
    required_other: float               # other open MOs' demand (excl. this unit)
    reserved_other: float = 0.0         # on-hand promised to OTHER open sales orders
    net_free: float                     # on_hand + incoming - required_other - reserved_other
    net_qty: float                      # qty actually made after netting
    decision: str                       # MAKE_ROOT | MAKE | RESIZE | SKIP | FORCED
    chips: list[NettingPreviewChip] = []    # size / color / combo identity of the row

class ProductionRunPreviewRequest(BaseModel):
    bom_entries: list[PRBomEntryCreate]
    location_code: str | None = None
    source_location_code: str | None = None
    exclude_pr_id: UUID | None = None   # set when re-previewing an existing PR

class MOPreviewRequest(BaseModel):
    bom_id: UUID
    qty: float
    location_code: str | None = None
    source_location_code: str | None = None
    create_nested: bool = True

class LocationCreate(BaseModel):
    code: str
    name: str
    parent_id: UUID | None = None        # null = top-level warehouse/area
    is_quarantine: bool = False          # stock here is on QC hold (inherited by children)

class LocationUpdate(BaseModel):
    name: str | None = None
    parent_id: UUID | None = None        # explicit null = move to top level
    is_quarantine: bool | None = None

class LocationResponse(BaseModel):
    id: UUID
    code: str
    name: str
    parent_id: UUID | None = None
    parent_name: str | None = None
    has_children: bool = False
    location_type: str = 'bin'
    system_code: str | None = None
    is_quarantine: bool = False
    full_path: str = ''

    class Config:
        from_attributes = True

# --- Work Order (operation step) Schemas ---

class WorkOrderCreate(BaseModel):
    manufacturing_order_id: UUID
    sequence: int = 1
    name: str | None = None
    work_center_id: UUID | None = None
    bom_operation_id: UUID | None = None
    input_location_id: UUID | None = None
    output_location_id: UUID | None = None
    next_destination_location_id: UUID | None = None
    next_destination_work_center_id: UUID | None = None
    qty: float | None = None
    ends: int | None = None
    planned_duration_hours: float | None = None
    notes: str | None = None
    target_start_date: datetime | None = None
    target_end_date: datetime | None = None
    # DYEING only: the bath the planner intends, litres. Seeds the auto-created
    # DyeingRun's PLAN (never its actual) so the Kartu Kerja prints weighed grams.
    # Left blank it falls back to the matched recipe's liquor_ratio x the load.
    bath_volume_liters: float | None = None

class WorkOrderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    manufacturing_order_id: UUID
    sequence: int
    code: str | None = None
    name: str
    work_center_id: UUID | None = None
    work_center_name: str | None = None
    work_center_type: str | None = None
    bom_operation_id: UUID | None = None
    staging_status: str = "NOT_STAGED"
    planned_recipe_id: UUID | None = None
    input_location_id: UUID | None = None
    output_location_id: UUID | None = None
    input_location: LocationResponse | None = None
    output_location: LocationResponse | None = None
    next_destination_location_id: UUID | None = None
    next_destination_work_center_id: UUID | None = None
    next_destination_location_name: str | None = None
    next_destination_work_center_name: str | None = None
    qty: float | None = None
    ends: int | None = None
    qty_completed_total: float = 0.0
    qty_rejected_total: float = 0.0   # scrap logged against this routing step
    status: str
    planned_duration_hours: float | None = None
    actual_duration_hours: float | None = None
    notes: str | None = None
    # Over-assignment warning fields — set at endpoint level, not from ORM
    warning: str | None = None
    total_assigned: float | None = None
    mo_qty: float | None = None
    target_start_date: datetime | None = None
    target_end_date: datetime | None = None
    actual_start_date: datetime | None = None
    actual_end_date: datetime | None = None
    card_printed_at: datetime | None = None
    labels_printed_at: datetime | None = None
    created_at: datetime


class WOStagedLot(BaseModel):
    """One lot already staged to a WO's input location by this WO.

    The `staged` total alone doesn't tell a dyeing stager WHICH greige lots make
    it up — two GRG- lots off the same item differ only by size, combo and shade.
    `qty` is what this WO moved in (nets any reversal); `on_line` is that lot's
    live balance at the input location, so a lot already consumed reads 0 left.
    """
    batch_id: UUID
    batch_number: Optional[str] = None
    qty: float = 0.0
    on_line: float = 0.0
    staged_at: Optional[datetime] = None
    vendor_lot: Optional[str] = None
    # Lot identity — same fields LotChips renders on batch pickers.
    bom_size_snapshot: Optional[dict] = None
    # Plain dicts, not BatchVariantAttr: that model is declared far below this one
    # and these rows are built server-side, so there's nothing to validate.
    variant_attributes: Optional[list[dict]] = None
    color_code: Optional[str] = None
    color_name: Optional[str] = None
    color_hex: Optional[str] = None
    labdip_variant_code: Optional[str] = None
    wo_code: Optional[str] = None
    mo_code: Optional[str] = None


class WORequiredMaterial(BaseModel):
    """One material a WO must stage to its input location (its step's share)."""
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    attribute_value_ids: list[UUID] = []
    uom: str | None = None
    required_qty: float
    source_location_id: UUID | None = None
    source_location_name: str | None = None
    on_hand: float = 0.0        # available at source location (rolled up across leaf spots)
    staged: float = 0.0         # already staged to this WO's input location
    shortfall: float = 0.0      # max(0, required - staged)
    lot_tracked: bool = False
    suggested_batch_id: UUID | None = None   # traced from this MO's BEAMING WO output; still overridable
    # Warp beams are loom resources, not per-WO material: `staged` for these is
    # the qty MOUNTED on the WO's machine (shared by every WO running there), and
    # readiness is counted in whole beams against the loom's beam_slots — not kg.
    is_beam: bool = False
    mounted_pcs: int = 0
    required_pcs: int = 0
    # The lots behind `staged` (non-beam rows only — a beam's identity comes from
    # the loom's mounts, which the staging modal already lists separately).
    staged_lots: list[WOStagedLot] = []


class WOStageLine(BaseModel):
    item_id: UUID
    qty: float
    source_location_id: UUID | None = None      # defaults to the line's resolved source
    batch_id: UUID | None = None                # required for lot-tracked materials
    attribute_value_ids: list[UUID] = []


class WOStagePayload(BaseModel):
    lines: list[WOStageLine]


class WOUnstageLine(BaseModel):
    item_id: UUID
    qty: float
    destination_location_id: UUID | None = None   # defaults to the line's resolved source store
    batch_id: UUID | None = None                  # required for lot-tracked materials
    attribute_value_ids: list[UUID] = []


class WOUnstagePayload(BaseModel):
    """Return staged material from a WO's input location to a store.

    The mirror of WOStagePayload: without it, material picked to the wrong line
    could only leave by being consumed, and `staging_status` never fell back.
    Warp beams are NOT unstaged here — they are loom resources and come off
    through POST /beam-mounts/{id}/dismount.
    """
    lines: list[WOUnstageLine]


class BeamMountResponse(BaseModel):
    """One warp beam currently up on a loom (or a closed historical mount)."""
    id: UUID
    batch_id: UUID
    beam_number: str | None = None
    work_center_id: UUID
    work_center_code: str | None = None
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    location_id: UUID | None = None
    # Where the remnant should go when this beam comes off: the beam item's home
    # store. Pre-selects the unmount dialog so the operator normally just confirms
    # instead of hunting for a bin on the floor.
    default_return_location_id: UUID | None = None
    ends: int | None = None
    qty_mounted: float = 0.0
    remaining: float = 0.0       # live batch balance at the loom
    # Lot identity of the beam itself — same fields LotChips renders on every batch
    # picker. A BM- number alone doesn't say what warp is up: two beams off the same
    # item differ only by size, combo and shade, and the supervisor reading the loom's
    # beam list is matching it against the physical warp. Plain dicts, not
    # BatchVariantAttr: that model is declared far below this one and these rows are
    # built server-side, so there's nothing to validate.
    bom_size_snapshot: dict | None = None
    variant_attributes: list[dict] | None = None
    color_code: str | None = None
    color_name: str | None = None
    color_hex: str | None = None
    labdip_variant_code: str | None = None
    source_wo_id: UUID | None = None
    mounted_at: datetime | None = None
    mounted_by: str | None = None
    dismounted_at: datetime | None = None
    dismounted_by: str | None = None


class BeamMountCreate(BaseModel):
    batch_id: UUID
    qty: float | None = None            # default: move the beam's whole remaining stock
    source_wo_id: UUID | None = None    # WO whose screen triggered it (audit only)


class BeamDismountPayload(BaseModel):
    # Where the remnant goes. Null leaves it parked at the loom.
    to_location_id: UUID | None = None
    # Weighed remnant — the floor strips and weighs the warp on every dismount.
    # That qty becomes a NEW leftover lot, the parent beam is retired at 0, and
    # the difference against the system remaining is written off on the parent.
    # 0 is meaningful — "nothing left", so reconcile the beam down to empty.
    leftover_qty: float
    leftover_beam_number: str | None = None   # blank → auto LFT-YYYYMMDD-NNNN
    leftover_ends: int | None = None          # blank → inherit the parent beam's ends
    leftover_notes: str | None = None


class BeamDismountResult(BeamMountResponse):
    """A closed mount plus what the dismount produced.

    Declared as its own model because a manual dict row under a response_model
    silently drops undeclared keys — the leftover lot would vanish from the
    response without a word.
    """
    leftover_batch_id: UUID | None = None
    leftover_beam_number: str | None = None
    leftover_qty: float = 0.0
    # weighed − system remaining. Negative = warp the system thought was there
    # and the scale says is not (the usual direction).
    leftover_variance: float = 0.0


class AvailableBeamRow(BaseModel):
    """One beam lot that is free to mount — nothing is on a loom right now.

    Feeds the weaving monitor's Mount picker, which has no WO/item context: it
    asks "what warp can go up on this machine", not "what does this order need".
    """
    batch_id: UUID
    beam_number: str
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    ends: int | None = None
    remaining: float = 0.0
    location_id: UUID | None = None
    location_code: str | None = None
    # Leftover provenance — a stripped remnant off an earlier beam.
    is_leftover: bool = False
    parent_beam_number: str | None = None
    quality_status: str = "GOOD"
    created_at: datetime | None = None


class LoomBeamStatus(BaseModel):
    """Beam readiness of one machine, for the weaving monitor loom cards."""
    work_center_id: UUID
    work_center_code: str | None = None
    beam_slots: int = 1
    mounted_pcs: int = 0
    total_remaining: float = 0.0
    mounts: list[BeamMountResponse] = []
    # Prep state of the loom itself (IDLE/STAGED/DRAW_IN/TUNING/RUNNING) — derived
    # server-side so the monitor card and this panel can never disagree.
    loom_status: str = "IDLE"
    next_loom_step: str | None = None
    prep_status: str | None = None
    prep_status_at: datetime | None = None
    prep_status_by: str | None = None


class LoomPrepUpdate(BaseModel):
    """Manual loom prep step. None = reset back to STAGED."""
    status: str | None = None


class PutawayBinOption(BaseModel):
    """One candidate destination bin under a WO's output location."""
    id: UUID
    code: str
    name: str
    full_path: str
    item_on_hand: float = 0.0    # output item already sitting in this bin
    total_on_hand: float = 0.0   # any stock in this bin (0 = empty)


class PutawaySuggestionResponse(BaseModel):
    suggested_location_id: UUID | None = None
    reason: str | None = None    # 'configured' | 'same_item' | 'empty_bin' | 'first_bin'
    bins: list[PutawayBinOption] = []


# ── Flat Work Order list (dedicated GET /work-orders endpoint) ──────────────

class WorkOrderCompletionItemFlat(BaseModel):
    item_id: str
    item_code: str | None = None
    qty_used: float


class WorkOrderCompletionFlat(BaseModel):
    id: str
    qty_completed: float
    qty_cones: int | None = None
    qty_boxes: int | None = None
    operator_name: str | None = None
    work_center_name: str | None = None
    created_at: datetime | None = None
    notes: str | None = None
    actual_items: list[WorkOrderCompletionItemFlat] = []
    rejected: bool = False
    qty_rejected: float = 0.0   # scrapped out of this log entry (partial or whole)
    reject_reason: str | None = None
    reject_location_name: str | None = None  # defect store the scrap was moved into
    output_batch_number: str | None = None   # output lot; drives per-bag label reprint on the WO list
    output_batch_notes: str | None = None    # clean operator note on that lot — printed on the bag label


class WorkOrderFlatResponse(BaseModel):
    id: str
    code: str | None = None
    sequence: int
    name: str
    status: str
    qty: float | None = None
    qty_completed_total: float | None = None
    qty_rejected_total: float | None = None
    planned_duration_hours: float | None = None
    actual_duration_hours: float | None = None
    target_start_date: datetime | None = None
    target_end_date: datetime | None = None
    actual_start_date: datetime | None = None
    actual_end_date: datetime | None = None
    card_printed_at: datetime | None = None
    labels_printed_at: datetime | None = None
    notes: str | None = None
    created_at: datetime | None = None
    work_center_id: str | None = None
    work_center_name: str | None = None
    work_center_type: str | None = None
    input_location: LocationResponse | None = None
    output_location: LocationResponse | None = None
    next_destination_location_id: str | None = None
    next_destination_work_center_id: str | None = None
    next_destination_location_name: str | None = None
    next_destination_work_center_name: str | None = None
    ends: int | None = None
    staging_status: str = "NOT_STAGED"
    bom_operation_id: str | None = None
    mo_id: str
    mo_code: str
    # Top of the parent_mo_id / MODependency chain. A consolidated component MO is
    # shared across variants, so it can peg to several roots — the extras ride in
    # `root_mo_codes` and `root_mo_count`.
    root_mo_id: str | None = None
    root_mo_code: str | None = None
    root_mo_count: int = 0
    root_mo_codes: list[str] = []
    item_name: str
    item_id: str
    combo_label: str | None = None   # MO's Combo (system_role='combo') attribute value, if any
    color_label: str | None = None   # MO's Colors (system_role='color') attribute value, if any
    size_label: str | None = None    # MO's BOM size label/measurement, if any
    # Color spec of the MO's item (Color Library). `labdip_variant_code` stands in while
    # the shade is still pending lab-dip approval (color_id null) — dyeing WOs are gated on it.
    color_id: str | None = None
    color_code: str | None = None
    color_name: str | None = None
    color_hex: str | None = None
    labdip_variant_code: str | None = None
    completions: list[WorkOrderCompletionFlat] = []
    bom_line_item_ids: list[str] = []


class WorkOrderFlatPageResponse(BaseModel):
    items: list[WorkOrderFlatResponse]
    total: int
    page: int
    size: int


class WorkOrderMarkPrintedBulk(BaseModel):
    ids: list[str] = []
    kind: str = "card"   # "card" (Kartu Kerja) | "labels" (bag labels)


# Resolve forward references now that all referenced schemas are defined
ManufacturingOrderResponse.update_forward_refs()


# ── Slimmed Production-Run LIST schemas ───────────────────────────────────────
# Returned by GET /production-runs instead of the full ProductionRunResponse.
# They drop the two heaviest, list-unused parts of the embedded MO tree: each MO's
# deep BOM sub-tree (bom.lines + line items + line attrs + operations + sizes) and
# planned_components. An audit of every consumer of the shared `productionRuns`
# state confirmed nothing reads those off list MOs — the SO-page PR-dedup and the
# MO-page shared-component tree read only scalars + the shallow relations retained
# below. `bom` is omitted from the MO item so the loader can skip the per-MO BOM
# fan-out entirely (Pydantic would otherwise lazy-load it and raise MissingGreenlet).
class ManufacturingOrderListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    bom_id: UUID
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    item_ends: int | None = None
    sales_order_id: UUID | None = None
    sales_order_code: str | None = None
    parent_mo_id: UUID | None = None
    production_run_id: UUID | None = None
    bom_size_id: UUID | None = None
    bom_size_snapshot: dict | None = None
    is_shared_component: bool = False
    attribute_value_ids: list[UUID] = []
    color_id: UUID | None = None
    color_code: str | None = None
    color_name: str | None = None
    labdip_variant_code: str | None = None
    labdip_status: str | None = None
    location_id: UUID | None = None
    source_location_id: UUID | None = None
    planned_putaway_location_id: UUID | None = None
    planned_putaway_location_name: str | None = None
    qty: float
    status: str
    # Output overdelivery allowance. Null on legacy rows — treat as the 10% default.
    overdelivery_tolerance_pct: float | None = None
    allow_unlimited_overdelivery: bool = False
    target_start_date: datetime | None
    target_end_date: datetime | None
    actual_start_date: datetime | None
    actual_end_date: datetime | None
    created_at: datetime
    card_printed_at: datetime | None = None
    is_material_available: bool = True
    qty_completed_total: float = 0.0
    qty_rejected_total: float = 0.0
    required_mo_ids: list[UUID] = []
    # `bom` intentionally omitted (see class docstring above).
    child_mos: list['ManufacturingOrderListItem'] = []
    work_orders: list['WorkOrderResponse'] = []
    batch_trace: list[BatchConsumptionInMO] = []
    completions: list[MOCompletionResponse] = []

ManufacturingOrderListItem.update_forward_refs()


class PRListBomRef(BaseModel):
    """Shallow BOM reference for the PR list — code + item identity only. `item_code`
    / `item_name` are BOM properties over `self.item`, so the loader must eager-load
    BOM.item; no bom.lines / operations / sizes are pulled."""
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    item_code: str | None = None
    item_name: str | None = None


class PRListEntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    bom_id: UUID
    total_qty: float | None = None
    attribute_value_ids: list[UUID] = []
    color_id: UUID | None = None
    labdip_variant_code: str | None = None
    force_create: bool = False
    bom: Optional[PRListBomRef] = None
    # `sizes` and the deep `bom` tree intentionally omitted (unused by list consumers).


class ProductionRunListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    bom_id: UUID | None = None
    sales_order_id: UUID | None = None
    sales_order_code: str | None = None
    location_id: UUID | None = None
    source_location_id: UUID | None = None
    status: str
    notes: str | None = None
    target_start_date: datetime | None = None
    target_end_date: datetime | None = None
    actual_start_date: datetime | None = None
    actual_end_date: datetime | None = None
    created_at: datetime
    bom: Optional[PRListBomRef] = None
    bom_entries: list[PRListEntryResponse] = []
    manufacturing_orders: list[ManufacturingOrderListItem] = []


class PaginatedProductionRunListResponse(BaseModel):
    items: list[ProductionRunListItem]
    total: int
    page: int
    size: int


class PRMaterialStatusRequest(BaseModel):
    pr_ids: list[UUID] = []


class PRMaterialStatusItem(BaseModel):
    pr_id: UUID
    total_count: int = 0
    shortfall_count: int = 0
    sufficient_count: int = 0


class ItemCreate(BaseModel):
    code: str
    name: str
    uom: str
    category_id: UUID | None = None
    attribute_ids: list[UUID] = []
    variant_type: str | None = None
    source_sample_id: UUID | None = None
    source_color_id: UUID | None = None
    weight_per_unit: float | None = None
    weight_unit: str | None = None
    packaging_factor_ids: list[UUID] = []
    ends: int | None = None
    lot_tracked: bool = False
    is_decoupling_point: bool = False
    min_stock_level: float | None = None
    default_source_location_id: UUID | None = None
    default_putaway_location_id: UUID | None = None
    # Defect store for this item's scrap; used when the producing work center has
    # no reject location of its own (see services/reject_service.py).
    default_reject_location_id: UUID | None = None


class ItemUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    uom: str | None = None
    category_id: UUID | None = None
    attribute_ids: list[UUID] | None = None
    variant_type: str | None = None
    source_sample_id: UUID | None = None
    source_color_id: UUID | None = None
    active: bool | None = None
    weight_per_unit: float | None = None
    weight_unit: str | None = None
    packaging_factor_ids: list[UUID] | None = None
    ends: int | None = None
    lot_tracked: bool | None = None
    is_decoupling_point: bool | None = None
    min_stock_level: float | None = None
    default_source_location_id: UUID | None = None
    default_putaway_location_id: UUID | None = None
    default_reject_location_id: UUID | None = None


class ItemResponse(BaseModel):
    id: UUID
    code: str
    name: str
    uom: str
    active: bool
    category_id: UUID | None = None
    category_path: list[str] = []
    attribute_ids: list[UUID] = []
    variant_type: str | None = None
    source_sample_id: UUID | None = None
    source_color_id: UUID | None = None
    source_sample_code: str | None = None
    source_color_name: str | None = None
    weight_per_unit: float | None = None
    weight_unit: str | None = None
    packaging_factor_ids: list[UUID] = []
    ends: int | None = None
    lot_tracked: bool = False
    is_decoupling_point: bool = False
    min_stock_level: float | None = None
    default_source_location_id: UUID | None = None
    default_putaway_location_id: UUID | None = None
    default_reject_location_id: UUID | None = None

    class Config:
        from_attributes = True

class PaginatedItemResponse(BaseModel):
    items: list[ItemResponse]
    total: int
    page: int
    size: int

class StockEntryCreate(BaseModel):
    item_code: str
    location_code: str
    attribute_value_ids: list[UUID] = []
    qty: float
    reference_type: str = "manual"
    reference_id: str = "manual_entry"
    qty_cones: int | None = None
    qty_boxes: int | None = None
    qty_drums: int | None = None
    batch_id: UUID | None = None

class StockTransferCreate(BaseModel):
    item_id: UUID
    from_location_id: UUID
    to_location_id: UUID
    qty: float
    batch_id: UUID | None = None
    attribute_value_ids: list[UUID] = []
    qty_cones: int | None = None
    qty_boxes: int | None = None
    qty_drums: int | None = None

# Multi-row move: the operator ticks several on-hand rows and sends them to ONE
# destination in a single transaction. Each line keeps its own source location,
# lot and variant — only the destination is shared.
class StockBulkTransferLine(BaseModel):
    item_id: UUID
    from_location_id: UUID
    qty: float
    batch_id: UUID | None = None
    attribute_value_ids: list[UUID] = []
    qty_cones: int | None = None
    qty_boxes: int | None = None
    qty_drums: int | None = None

class StockBulkTransferCreate(BaseModel):
    to_location_id: UUID
    lines: list[StockBulkTransferLine]

class StockLedgerResponse(BaseModel):
    id: UUID
    item_id: UUID
    item_name: str = ""
    item_code: str = ""
    item_uom: str = ""
    item_category_id: UUID | None = None
    item_category_name: str | None = None
    attribute_value_ids: list[UUID] = []
    location_id: UUID
    location_name: str = ""
    qty_change: float
    qty_cones_change: int | None = None
    qty_boxes_change: int | None = None
    qty_drums_change: int | None = None
    reference_type: str
    reference_id: str
    reference_label: str | None = None
    batch_id: UUID | None = None
    batch_number: str | None = None
    vendor_lot: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True

class PaginatedStockLedgerResponse(BaseModel):
    items: list[StockLedgerResponse]
    total: int
    page: int
    size: int
    # Aggregates over the full filtered set (not just the current page).
    total_in: float = 0
    total_out: float = 0
    # Distinct reference types across the whole ledger — powers the filter dropdown.
    reference_types: list[str] = []

class StockBalanceResponse(BaseModel):
    item_id: UUID
    item_name: str = ""
    item_code: str = ""
    item_uom: str = ""
    item_ends: int | None = None
    item_category_id: UUID | None = None
    item_category_name: str | None = None
    attribute_value_ids: list[UUID] = []
    location_id: UUID
    location_name: str = ""
    qty: float
    qty_cones: int = 0
    qty_boxes: int = 0
    qty_drums: int = 0
    batch_key: str = ""
    batch_number: str | None = None
    vendor_lot: str | None = None   # supplier's lot ref — only set on goods-receipt lots
    size_label: str | None = None   # lot's BOM size (from Batch.bom_size_snapshot), if any — mainly sized greige lots
    batch_notes: str | None = None  # Batch.notes — operator's note from the WO completion that produced the lot
    # QC flag of the lot (GOOD | REJECTED). The service has always emitted this and
    # the UI reads it to tint/flag unusable rows; it was missing here, so the response
    # model silently stripped it and rejected stock displayed as if it were good.
    quality_status: str = "GOOD"
    # Production origin of the lot, resolved Batch.source_wo_id → WO → MO. Only set
    # for lots minted by a WO completion (goods-receipt GR- lots have no source WO).
    mo_id: UUID | None = None
    mo_code: str | None = None
    wo_code: str | None = None
    # Shade identity of the lot's producing MO (Color Library, via MO.color_id) —
    # same fields /batches/paginated resolves, so the shade chip matches everywhere.
    color_code: str | None = None
    color_name: str | None = None
    color_hex: str | None = None
    labdip_variant_code: str | None = None

class PaginatedStockBalanceResponse(BaseModel):
    """Envelope for GET /stock/balance/paginated — the Stock On-Hand grid.

    The aggregate fields are computed over the WHOLE filtered set, not the page:
    the footer summary they feed ("N rows / N negative / N rejected") would
    otherwise silently report page-only numbers. `total_rows` is the unfiltered
    balance-row count behind the footer's "Total: N SKUs".
    """
    items: list[StockBalanceResponse]
    total: int
    page: int = 1
    size: int = 50
    negative_count: int = 0
    rejected_count: int = 0
    rejected_qty: float = 0
    total_rows: int = 0

class UOMCreate(BaseModel):
    name: str

class UOMFactorCreate(BaseModel):
    to_uom_id: UUID
    value: float

class UOMFactorResponse(BaseModel):
    id: UUID
    from_uom_id: UUID
    to_uom_id: UUID
    from_uom_name: str = ''
    to_uom_name: str = ''
    value: float

    class Config:
        from_attributes = True

class UOMResponse(UOMCreate):
    id: UUID
    is_system: bool = False
    factors: list[UOMFactorResponse] = []

    class Config:
        from_attributes = True

class CategoryCreate(BaseModel):
    name: str
    parent_id: UUID | None = None


class CategoryResponse(BaseModel):
    id: UUID
    name: str
    parent_id: UUID | None
    level: int
    path_names: list[str]
    is_system: bool = False

    class Config:
        from_attributes = True

class WorkCenterCreate(BaseModel):
    code: str
    name: str
    description: str | None = None
    cost_per_hour: float = 0.0
    center_type: str = "GENERAL"
    input_location_id: UUID | None = None
    output_location_id: UUID | None = None
    # Defect store for output this center rejects (WEAVING → greige BS, BEAMING →
    # beam-reject store). Inherited down the tree like the other two.
    reject_location_id: UUID | None = None
    parent_id: UUID | None = None
    # TYPE | GROUP | MACHINE. Null = derive from parent_id the legacy way (no
    # parent → TYPE root, parent → MACHINE), so older clients keep working.
    node_type: str | None = None
    beam_slots: int = 1
    # Yards the rope advances per reel revolution (dyeing vessels). Machine
    # geometry, so it rides here beside beam_slots rather than on each run.
    yards_per_rev: float | None = None

class WorkCenterResponse(BaseModel):
    id: UUID
    code: str
    name: str
    description: str | None = None
    cost_per_hour: float = 0.0
    center_type: str = "GENERAL"
    input_location_id: UUID | None = None
    output_location_id: UUID | None = None
    reject_location_id: UUID | None = None
    parent_id: UUID | None = None
    node_type: str = "MACHINE"
    input_location: LocationResponse | None = None
    output_location: LocationResponse | None = None
    reject_location: LocationResponse | None = None
    # Locations are inherited down the tree: a machine with no own value uses its
    # GROUP's (then its TYPE's). input_location_id/output_location_id above are the
    # raw override on this row; these are what actually applies. Set by
    # work_center_service.decorate_effective_locations, not columns.
    effective_input_location_id: UUID | None = None
    effective_output_location_id: UUID | None = None
    effective_reject_location_id: UUID | None = None
    input_location_inherited: bool = False
    output_location_inherited: bool = False
    reject_location_inherited: bool = False
    working_weekdays: list[int] | None = None
    beam_slots: int = 1
    yards_per_rev: float | None = None

    class Config:
        from_attributes = True

class OperationCreate(BaseModel):
    code: str
    name: str
    description: str | None = None

class OperationResponse(OperationCreate):
    id: UUID
    is_system: bool = False

    class Config:
        from_attributes = True

# --- Partner (Customer/Supplier) Schemas ---

class PartnerCreate(BaseModel):
    name: str
    address: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    fax: Optional[str] = None
    email: Optional[str] = None
    type: str # CUSTOMER or SUPPLIER
    active: bool = True

class PartnerUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    fax: Optional[str] = None
    email: Optional[str] = None
    active: Optional[bool] = None

class PartnerResponse(PartnerCreate):
    id: UUID
    class Config:
        from_attributes = True

class PaginatedPartnerResponse(BaseModel):
    items: list[PartnerResponse]
    total: int
    page: int
    size: int
    # Whole-directory counts scoped by `type` only (not search/active) — the classic
    # status bar shows "N total / N active" for every partner of that type, not the
    # current page. Declared here because response_model drops undeclared keys.
    type_total: int = 0
    type_active: int = 0

# --- Purchase Order (Outgoing) Schemas ---

class PurchaseOrderLineCreate(BaseModel):
    item_id: UUID
    qty: float
    unit_price: float | None = None
    due_date: datetime | None = None
    attribute_value_ids: list[UUID] = []

class PurchaseOrderLineResponse(PurchaseOrderLineCreate):
    id: UUID
    qty_received: float = 0
    attribute_value_ids: list[UUID] = []
    item_name: str | None = None
    item_code: str | None = None
    item_uom: str | None = None
    class Config:
        from_attributes = True

class PurchaseOrderCreate(BaseModel):
    po_number: str
    supplier_id: UUID
    target_location_id: UUID | None = None
    order_date: datetime | None = None
    ssn: str | None = None
    rate_mode: str | None = "kurs_pajak"
    kurs_pajak: str | None = None
    ktbi: str | None = None
    code: str | None = None
    payment_term: str | None = None
    category: str | None = None
    vat_percent: float | None = 11
    discount: float | None = 0
    notes: str | None = None
    lines: list[PurchaseOrderLineCreate]

# --- Goods Receipt Schemas ---

class GoodsReceiptLineCreate(BaseModel):
    po_line_id: UUID
    qty_received: float
    qty_boxes: int | None = None
    qty_cones: int | None = None  # raw material packaging
    qty_drums: int | None = None  # chemical/dye packaging
    batch_id: UUID | None = None
    vendor_lot: str | None = None  # supplier's lot number; same supplier+item+lot merges into the existing internal lot, else one is auto-generated

class GoodsReceiptCreate(BaseModel):
    receipt_date: datetime | None = None
    notes: str | None = None
    location_id: UUID | None = None  # receiving warehouse; falls back to PO target location
    delivery_note_number: str | None = None  # supplier Surat Jalan no.
    delivery_note_date: date | None = None    # date on the supplier DN
    lines: list[GoodsReceiptLineCreate]

class GoodsReceiptLineResponse(BaseModel):
    id: UUID
    po_line_id: UUID
    item_id: UUID
    item_name: str | None = None
    item_code: str | None = None
    item_uom: str | None = None
    qty_received: float
    qty_boxes: int | None = None
    qty_cones: int | None = None
    qty_drums: int | None = None
    batch_id: UUID | None = None
    vendor_lot: str | None = None    # supplier's lot reference
    internal_lot: str | None = None  # system-generated internal batch number
    class Config:
        from_attributes = True

class GoodsReceiptResponse(BaseModel):
    id: UUID
    po_id: UUID
    location_id: UUID | None = None
    receipt_date: datetime
    notes: str | None = None
    delivery_note_number: str | None = None
    delivery_note_date: date | None = None
    delivery_note_url: str | None = None
    created_at: datetime
    lines: list[GoodsReceiptLineResponse] = []
    class Config:
        from_attributes = True

class PurchaseOrderResponse(PurchaseOrderCreate):
    supplier_id: UUID | None = None  # legacy POs predating the required-supplier constraint have no supplier
    id: UUID
    status: str
    lines: list[PurchaseOrderLineResponse]
    receipts: list[GoodsReceiptResponse] = []
    created_at: datetime
    class Config:
        from_attributes = True

class PaginatedPurchaseOrderResponse(BaseModel):
    items: list[PurchaseOrderResponse]
    total: int
    page: int = 1
    size: int = 50
    #: Unfiltered, all-time {status: count} for the list's chips + status bar.
    status_counts: dict[str, int] = {}

# --- Sales Schemas ---

class SalesOrderLineCreate(BaseModel):
    item_id: UUID
    qty: float
    due_date: datetime | None = None
    internal_confirmation_date: datetime | None = None
    ket_stock: str | None = None
    qty_kg: float | None = None
    qty2: float | None = None
    uom2: str | None = None
    uom2_factor: float | None = None
    attribute_value_ids: list[UUID] = []
    # The recipe picked on the line. Several attribute-less BOMs can exist for one
    # item (per-shade roots), so this pick is what the PR pre-fill trusts.
    bom_id: UUID | None = None
    # Legacy per-BOM size pointer. Optional and no longer what the UI writes: a
    # BOMSize belongs to one BOM, so it cannot be picked before the recipe is.
    bom_size_id: UUID | None = None
    # The ordered size, recipe-independent: `size_id` for a Size master row
    # (S/M/L/...), `size_label` for a free-mode BOM's label. The PR resolves this
    # against whichever BOM the planner picks.
    size_id: UUID | None = None
    size_label: str | None = None
    color_id: UUID | None = None
    labdip_variant_code: str | None = None
    labdip_item_id: UUID | None = None
    # Customer hasn't supplied the physical swatch yet. Display-only flag.
    no_color_swatch: bool = False

class BatchVariantAttr(BaseModel):
    """One variant attribute value of the MO that produced a lot (Combo, Colors, …) —
    or, on a SalesOrderLineResponse, of the order line itself. Same shape either
    way so a picker can label a lot and an SO line identically."""
    name: str
    value: str
    hex: Optional[str] = None
    system_role: Optional[str] = None   # 'combo' | 'color' | 'material' | ...

class SOLineMOStep(BaseModel):
    """One work-order step of an MO pegged to a sales-order line."""
    code: str | None = None
    name: str | None = None
    # The shop-floor word for the step: work-center type (WEAVING, DYEING), or
    # the machine name when the type is the meaningless GENERAL default.
    stage: str | None = None
    status: str
    sequence: int | None = None

class SOLineMOComponent(BaseModel):
    """One pegged component MO (greige, warp beam) behind a finished-goods order.

    `need` is the qty THIS order requires of it, scaled down the peg chain, so
    `pct` reads 100 once that share exists even when the shared MO's own plan is
    twenty times larger. Readiness, not allocation — see `_fold_components`.
    """
    mo_id: str
    mo_code: str | None = None
    mo_status: str | None = None
    level: int = 1
    need: float = 0
    made: float = 0
    pct: int = 0

class SOLineMO(BaseModel):
    mo_id: str
    mo_code: str | None = None
    mo_status: str | None = None
    # Produced vs planned for this one order, in the item's stock UoM.
    # `output_pct` is derived from these two, capped at 100 — `mo_qty` is a
    # target, not a ceiling, so the uncapped truth stays readable here.
    mo_qty: float = 0
    made: float = 0
    # This order's own output, before component progress is folded in.
    output_pct: int = 0
    components: list[SOLineMOComponent] = []
    components_done: int = 0
    components_total: int = 0
    steps_done: int = 0
    steps_total: int = 0
    pct: int = 0
    current_stage: str | None = None
    current_stage_running: bool = False
    steps: list[SOLineMOStep] = []

class SOLineMOProgress(BaseModel):
    """How much of the production behind one SO line has been made.

    Derived by so_fulfilment_service.mo_progress_map and pegged to the line the
    same way `qty_made` is. `mo_count` > 1 when several root MOs answer the same
    line — quantities pool, since they are batches of one demand.

    `pct` is what the Production Output bar draws: this line's finished-goods
    output AND the pegged component MOs behind it (greige, warp beams), weighted
    one share per BOM level. `output_pct` is the finished goods alone.

    `made`/`mo_qty` are the MO-side figures and are **not** pro-rata split on an
    ambiguous peg; the table's qty label reads `qty_made` (which is) and uses
    these for the per-order tooltip only. Step counts survive to *locate* the
    work (`current_stage`), not to measure it.
    """
    mo_count: int = 0
    mo_code: str | None = None
    mo_qty: float = 0
    made: float = 0
    # `output_pct` is finished-goods output alone; `pct` folds in the pegged
    # component MOs (greige, warp beams) and is what the bar draws.
    output_pct: int = 0
    components_done: int = 0
    components_total: int = 0
    steps_done: int = 0
    steps_total: int = 0
    pct: int = 0
    current_stage: str | None = None
    current_stage_running: bool = False
    mos: list[SOLineMO] = []

class SalesOrderLineResponse(SalesOrderLineCreate):
    id: UUID
    attribute_value_ids: list[UUID] = []
    bom_id: UUID | None = None
    bom_size_id: UUID | None = None
    color_id: UUID | None = None
    color_code: str | None = None
    color_name: str | None = None
    color_hex: str | None = None
    labdip_variant_code: str | None = None
    labdip_item_id: UUID | None = None
    labdip_status: str | None = None
    item_name: str | None = None
    item_code: str | None = None
    # This line's size as text — e.g. "M", or a free-mode label — resolved from
    # `size_id`/`size_label`, falling back to the legacy `bom_size_id` pointer for
    # rows written before the decoupling. Read-only; `size_label` above is what is
    # stored. Paired with any other attribute values (combo, …) so a picker can
    # tell same-item lines apart the same way it labels a lot (see BatchVariantAttr).
    size_display: str | None = None
    variant_attributes: list[BatchVariantAttr] | None = None
    # Derived fulfilment (so_fulfilment_service) — never stored on the line.
    # `packed_available` is what decides whether the order can ship.
    qty_made: float = 0
    qty_packed: float = 0
    qty_packed_available: float = 0
    qty_dispatched: float = 0
    # `qty` is in yards; the four numbers above are in the item's stock UoM
    # (`base_uom`). Progress must be measured against this, not against `qty`.
    # None when the item is stocked by weight but carries no weight-per-yard —
    # render that as unknown, never as 0%.
    qty_ordered_base: float | None = None
    base_uom: str | None = None
    # --- The same fulfilment, counted in the line's alt selling unit ----------
    # `uom2` is what the customer ordered in and is owed in (2880 Pcs, 40 Pic), so
    # this is the pair the fulfilment bar draws and the pair READY/SENT gates on;
    # the base figures above stay the unit stock moves in. Null on a line with no
    # alt unit, or one that states a unit with no count — consumers fall back to
    # the base pair rather than drawing a bar against nothing.
    #
    # Packed/available/shipped are SUMMED from the cartons' own `alt_qty`, never
    # divided out of the kilos (see so_fulfilment_service). `qty_made_alt` is the
    # one converted figure — bulk FG has not been cut into pieces yet.
    qty_ordered_alt: float | None = None
    alt_uom: str | None = None
    qty_made_alt: float | None = None
    qty_packed_alt: float | None = None
    qty_packed_available_alt: float | None = None
    qty_dispatched_alt: float | None = None
    # Production progress (qty made vs planned) of the MOs behind this line, plus
    # the stage the floor is on. Populated by the list endpoint only
    # (_populate_mo_progress); None means no MO exists for the line yet, which the
    # table renders as an em dash rather than an empty bar.
    mo_progress: SOLineMOProgress | None = None

    class Config:
        from_attributes = True

class SalesOrderCreate(BaseModel):
    po_number: str
    customer_po_ref: str | None = None
    customer_name: str
    order_date: datetime | None = None
    lines: list[SalesOrderLineCreate]

class SalesOrderUpdate(BaseModel):
    po_number: str
    customer_po_ref: str | None = None
    customer_name: str
    order_date: datetime | None = None
    notes: str | None = None
    lines: list[SalesOrderLineCreate]

class SOPRRef(BaseModel):
    """The PR chip on a sales-order row — id for the lineage button, code for display."""
    id: UUID
    code: str

class SalesOrderResponse(BaseModel):
    id: UUID
    po_number: str
    customer_po_ref: str | None = None
    customer_name: str
    order_date: datetime
    status: str
    delivered_at: datetime | None = None
    lines: list[SalesOrderLineResponse]
    created_at: datetime
    # Populated by the list endpoint only (_populate_production_runs). Mutation
    # responses leave it empty — every SO mutation refetches the list, so nothing
    # renders off a stale [].
    production_runs: list[SOPRRef] = []
    # Same deal (_populate_reserved): on-hand FG this order's PR netted away and
    # now holds. 0 on mutation responses.
    reserved_qty: float = 0.0
    class Config:
        from_attributes = True

class PaginatedSalesOrderResponse(BaseModel):
    items: list[SalesOrderResponse]
    total: int
    page: int = 1
    size: int = 50
    status_counts: dict[str, int] = {}

class SOPRCoverageEntry(BaseModel):
    bom_id: UUID
    attribute_value_ids: list[str] = []
    color_id: UUID | None = None
    labdip_variant_code: str | None = None

class SOPRCoverageResponse(BaseModel):
    """Duplicate-PR guard for one SO — see GET /sales-orders/{id}/pr-coverage."""
    covered_size_ids: list[str] = []
    # The same coverage keyed by folded size NAME. An SO line states its size
    # generically now, so it has no BOMSize id to compare against
    # `covered_size_ids` — the caller matches on this instead.
    covered_size_tokens: list[str] = []
    covered_entries: list[SOPRCoverageEntry] = []

class StockReservationResponse(BaseModel):
    """One pile of on-hand FG promised to a sales order — see
    GET /sales-orders/{id}/reservations."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    sales_order_id: UUID
    production_run_id: UUID | None = None
    production_run_code: str | None = None
    item_id: UUID
    item_code: str = ""
    item_name: str = ""
    uom: str = ""
    variant_key: str = ""
    attribute_value_ids: list[str] = []
    color_id: UUID | None = None
    color_code: str | None = None
    color_name: str | None = None
    size_label: str | None = None
    qty: float
    qty_released: float = 0.0
    qty_remaining: float = 0.0
    status: str
    created_at: datetime | None = None
    released_at: datetime | None = None


class SOReservationSummary(BaseModel):
    """Reservations for one SO plus the roll-up the SO page shows."""
    reservations: list[StockReservationResponse] = []
    total_reserved: float = 0.0     # sum of qty_remaining on ACTIVE rows
    total_released: float = 0.0


# --- Sample Request Schemas ---

class SampleColorCreate(BaseModel):
    name: str
    is_repeat: bool = False
    order: int = 0

class SampleColorResponse(BaseModel):
    id: UUID
    name: str
    is_repeat: bool = False
    order: int = 0
    status: str = "PENDING"
    rejection_reason: str | None = None
    rejection_notes: str | None = None
    approval_notes: str | None = None
    approval_image_url: str | None = None
    rejection_image_url: str | None = None
    item_id: UUID | None = None
    item_code: str | None = None
    # Attempt tallies — a variant can be rejected, reopened and rejected again, so
    # these are counts of logged events, not booleans over the current status.
    process_count: int = 0
    reject_count: int = 0
    approve_count: int = 0
    status_updated_at: Optional[datetime] = None
    first_process_at: Optional[datetime] = None
    last_process_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    rejected_at: Optional[datetime] = None
    class Config:
        from_attributes = True

class SampleColorEventResponse(BaseModel):
    id: UUID
    sample_color_id: UUID
    event: str
    previous_status: Optional[str] = None
    round_no: int = 1
    reason: Optional[str] = None
    notes: Optional[str] = None
    image_url: Optional[str] = None
    created_by_name: Optional[str] = None
    created_at: datetime
    class Config:
        from_attributes = True

class SampleRequestCreate(BaseModel):
    customer_id: Optional[UUID] = None
    request_date: Optional[str] = None
    project: Optional[str] = None
    customer_article_code: Optional[str] = None
    internal_article_code: Optional[str] = None
    width: Optional[str] = None
    variant_type: str = "color"
    # `Sample Category` system attribute value (role sample_category). `category` is
    # the display snapshot — resolved server-side from category_value_id when given,
    # and matched back to a value when only the text is sent (legacy clients).
    category_value_id: Optional[UUID] = None
    category: Optional[str] = None
    colors: list[SampleColorCreate] = []
    main_material: Optional[str] = None
    middle_material: Optional[str] = None
    bottom_material: Optional[str] = None
    weft: Optional[str] = None
    warp: Optional[str] = None
    original_weight: Optional[float] = None
    original_weight_unit: Optional[str] = None
    production_weight: Optional[float] = None
    production_weight_unit: Optional[str] = None
    additional_info: Optional[str] = None
    quantity: Optional[str] = None
    sample_size: Optional[str] = None
    estimated_completion_date: Optional[str] = None
    completion_description: Optional[str] = None
    notes: Optional[str] = None

class SampleColorUpdate(BaseModel):
    id: Optional[UUID] = None
    name: str
    is_repeat: bool = False
    order: int = 0

class SampleRequestUpdate(BaseModel):
    customer_id: Optional[UUID] = None
    request_date: Optional[str] = None
    project: Optional[str] = None
    customer_article_code: Optional[str] = None
    internal_article_code: Optional[str] = None
    width: Optional[str] = None
    variant_type: str = "color"
    category_value_id: Optional[UUID] = None
    category: Optional[str] = None
    colors: list[SampleColorUpdate] = []
    main_material: Optional[str] = None
    middle_material: Optional[str] = None
    bottom_material: Optional[str] = None
    weft: Optional[str] = None
    warp: Optional[str] = None
    original_weight: Optional[float] = None
    original_weight_unit: Optional[str] = None
    production_weight: Optional[float] = None
    production_weight_unit: Optional[str] = None
    additional_info: Optional[str] = None
    quantity: Optional[str] = None
    sample_size: Optional[str] = None
    estimated_completion_date: Optional[str] = None
    completion_description: Optional[str] = None
    notes: Optional[str] = None

class SampleRequestResponse(BaseModel):
    id: UUID
    code: str
    version: int
    status: str
    variant_type: str = "color"
    category: str = "New Sample"
    category_value_id: Optional[UUID] = None
    created_at: datetime
    is_unread: bool = False
    customer_id: Optional[UUID] = None
    request_date: Optional[date] = None
    project: Optional[str] = None
    customer_article_code: Optional[str] = None
    internal_article_code: Optional[str] = None
    width: Optional[str] = None
    colors: list[SampleColorResponse] = []
    main_material: Optional[str] = None
    middle_material: Optional[str] = None
    bottom_material: Optional[str] = None
    weft: Optional[str] = None
    warp: Optional[str] = None
    original_weight: Optional[float] = None
    original_weight_unit: Optional[str] = None
    production_weight: Optional[float] = None
    production_weight_unit: Optional[str] = None
    additional_info: Optional[str] = None
    quantity: Optional[str] = None
    sample_size: Optional[str] = None
    estimated_completion_date: Optional[date] = None
    completion_description: Optional[str] = None
    notes: Optional[str] = None
    completion_image_url: Optional[str] = None
    design_pdf_url: Optional[str] = None
    created_by_name: Optional[str] = None
    created_by_role: Optional[str] = None
    class Config:
        from_attributes = True

class SampleColorStats(BaseModel):
    """Color-grain tallies over the WHOLE filtered set, not just the page —
    the samples footer counts colors, and a page slice would under-report it."""
    total: int = 0
    PENDING: int = 0
    IN_PRODUCTION: int = 0
    SENT: int = 0
    APPROVED: int = 0
    REJECTED: int = 0

class PaginatedSampleRequestResponse(BaseModel):
    items: list[SampleRequestResponse]
    total: int
    page: int
    size: int
    unread: int = 0
    color_stats: SampleColorStats = SampleColorStats()

class SampleReportTotals(BaseModel):
    """Attempt counts over the report window. `processes`/`rejects`/`approvals` are
    event counts, so they can exceed `variants` — that is the point of the report."""
    variants: int = 0
    requests: int = 0
    processes: int = 0
    sent: int = 0
    approvals: int = 0
    rejects: int = 0
    approval_rate: float = 0.0
    avg_processes_per_variant: float = 0.0

class SampleReportVariantRow(BaseModel):
    color_id: UUID
    variant_name: str
    is_repeat: bool = False
    status: str = "PENDING"
    sample_id: UUID
    sample_code: str
    project: Optional[str] = None
    customer_article_code: Optional[str] = None
    category: Optional[str] = None
    customer_name: Optional[str] = None
    processes: int = 0
    sent: int = 0
    approvals: int = 0
    rejects: int = 0
    last_event_at: Optional[datetime] = None

class SampleReportGroupRow(BaseModel):
    label: str
    variants: int = 0
    processes: int = 0
    sent: int = 0
    approvals: int = 0
    rejects: int = 0
    approval_rate: float = 0.0

class SampleDevelopmentReport(BaseModel):
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    group_by: str = "customer"
    totals: SampleReportTotals = SampleReportTotals()
    rows: list[SampleReportVariantRow] = []
    groups: list[SampleReportGroupRow] = []

# --- Lab Dip Report Schemas ---
# Mirror of the sample development report, one tier down: the grain is a lab dip
# variant (LabDipItem) and the events are dips/approvals/rejections. There is no
# SENT stage in the lab dip flow, so that column has no counterpart here.

class LabDipReportTotals(BaseModel):
    """Attempt counts over the report window. `dips`/`rejects`/`approvals` are event
    counts, so they can exceed `variants` — that is the point of the report."""
    variants: int = 0
    requests: int = 0
    dips: int = 0
    approvals: int = 0
    rejects: int = 0
    approval_rate: float = 0.0
    avg_dips_per_variant: float = 0.0

class LabDipReportVariantRow(BaseModel):
    item_id: UUID
    variant_code: str
    item_code: Optional[str] = None
    item_name: Optional[str] = None
    status: str = "PENDING"
    request_id: UUID
    request_code: str
    kind: str = "FG"
    customer_name: Optional[str] = None
    customer_article_code: Optional[str] = None
    season: Optional[str] = None
    approved_color_code: Optional[str] = None
    dips: int = 0
    approvals: int = 0
    rejects: int = 0
    last_event_at: Optional[datetime] = None

class LabDipReportGroupRow(BaseModel):
    label: str
    variants: int = 0
    dips: int = 0
    approvals: int = 0
    rejects: int = 0
    approval_rate: float = 0.0

class LabDipDevelopmentReport(BaseModel):
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    group_by: str = "customer"
    totals: LabDipReportTotals = LabDipReportTotals()
    rows: list[LabDipReportVariantRow] = []
    groups: list[LabDipReportGroupRow] = []

# --- Lab Dip Request Schemas ---

# --- Color Library Schemas ---

class ColorCreate(BaseModel):
    code: str
    name: str
    pantone_ref: Optional[str] = None
    colour_index: Optional[str] = None
    hex: Optional[str] = None
    substrate: Optional[str] = None
    l_star: Optional[float] = None
    a_star: Optional[float] = None
    b_star: Optional[float] = None
    lab_illuminant: Optional[str] = None
    customer_id: Optional[UUID] = None
    customer_color_code: Optional[str] = None
    spectro_notes: Optional[str] = None
    notes: Optional[str] = None
    status: str = "active"
    variant_attribute_value_id: Optional[UUID] = None
    source_lab_dip_line_id: Optional[UUID] = None

class ColorUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    pantone_ref: Optional[str] = None
    colour_index: Optional[str] = None
    hex: Optional[str] = None
    substrate: Optional[str] = None
    l_star: Optional[float] = None
    a_star: Optional[float] = None
    b_star: Optional[float] = None
    lab_illuminant: Optional[str] = None
    customer_id: Optional[UUID] = None
    customer_color_code: Optional[str] = None
    spectro_notes: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    variant_attribute_value_id: Optional[UUID] = None

class ColorResponse(BaseModel):
    id: UUID
    code: str
    name: str
    pantone_ref: Optional[str] = None
    colour_index: Optional[str] = None
    hex: Optional[str] = None
    substrate: Optional[str] = None
    l_star: Optional[float] = None
    a_star: Optional[float] = None
    b_star: Optional[float] = None
    lab_illuminant: Optional[str] = None
    customer_id: Optional[UUID] = None
    customer_name: Optional[str] = None
    customer_color_code: Optional[str] = None
    spectro_notes: Optional[str] = None
    notes: Optional[str] = None
    status: str = "active"
    attribute_value_id: Optional[UUID] = None
    variant_attribute_value_id: Optional[UUID] = None
    variant_attribute_value_label: Optional[str] = None
    source_lab_dip_line_id: Optional[UUID] = None
    # Provenance: the LabDip request this shade was minted from (approval) or spawned
    # from (manual "+ Color"). Derived in the list endpoint, not stored on the row.
    source_lab_dip_request_id: Optional[UUID] = None
    source_lab_dip_code: Optional[str] = None
    source_item_name: Optional[str] = None
    source_item_code: Optional[str] = None
    recipe_count: int = 0
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class ColorListResponse(BaseModel):
    items: list[ColorResponse] = []
    total: int = 0
    page: int = 1
    size: int = 50


class ComboCreate(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    status: str = "active"

class ComboUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None

class ComboResponse(BaseModel):
    id: UUID
    code: str
    name: str
    description: Optional[str] = None
    status: str = "active"
    attribute_value_id: Optional[UUID] = None
    usage_count: int = 0
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class ComboListResponse(BaseModel):
    items: list[ComboResponse] = []
    total: int = 0
    page: int = 1
    size: int = 50


# --- Packaging types (the physical box a carton is packed in) ---------------
# Bounded master (a handful of rows: Box S/M/L/XL, Plastic Bag, Custom), served
# as a bare list on purpose — see the lookup-feed rule in CLAUDE.md.

class PackagingTypeCreate(BaseModel):
    code: str
    name: str
    tare_kg: Optional[float] = None
    is_custom: bool = False
    sort_order: int = 0
    active: bool = True

class PackagingTypeUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    tare_kg: Optional[float] = None
    is_custom: Optional[bool] = None
    sort_order: Optional[int] = None
    active: Optional[bool] = None

class PackagingTypeResponse(BaseModel):
    id: UUID
    code: str
    name: str
    tare_kg: Optional[float] = None
    is_custom: bool = False
    sort_order: int = 0
    active: bool = True
    created_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class LabDipLineCreate(BaseModel):
    color_name: str
    color_id: Optional[UUID] = None
    submission_round: int = 1
    recipe_ref: Optional[str] = None
    order: int = 0

class LabDipLineUpdate(BaseModel):
    id: Optional[UUID] = None
    color_name: str
    color_id: Optional[UUID] = None
    submission_round: int = 1
    recipe_ref: Optional[str] = None
    order: int = 0

class LabDipLineResponse(BaseModel):
    id: UUID
    lab_dip_item_id: Optional[UUID] = None
    color_name: str
    color_id: Optional[UUID] = None
    submission_round: int = 1
    recipe_ref: Optional[str] = None
    status: str = "PENDING"
    remarks: Optional[str] = None
    order: int = 0
    model_config = ConfigDict(from_attributes=True)

class LabDipRejectionResponse(BaseModel):
    id: UUID
    round_no: int = 1
    reason: Optional[str] = None
    notes: Optional[str] = None
    rejected_by: Optional[UUID] = None
    rejected_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)

class LabDipItemCreate(BaseModel):
    item_id: UUID
    order: int = 0
    dips: list[LabDipLineCreate] = []
    locked_variant_code: Optional[str] = None  # preserves a resubmitted item's original code.

class LabDipItemUpdate(BaseModel):
    id: Optional[UUID] = None
    item_id: UUID
    order: int = 0
    dips: list[LabDipLineUpdate] = []
    locked_variant_code: Optional[str] = None

class LabDipItemResponse(BaseModel):
    id: UUID
    item_id: UUID
    item_code: Optional[str] = None  # denormalized so display never needs the full catalog.
    item_name: Optional[str] = None
    order: int = 0
    variant_seq: int = 0
    variant_code: Optional[str] = None  # e.g. "00001-A"; set by the API layer.
    locked_variant_code: Optional[str] = None
    status: str = "PENDING"
    approved_set: Optional[str] = None
    approved_color_id: Optional[UUID] = None
    approved_color_code: Optional[str] = None  # e.g. "00001-A-5"; set by the API layer.
    rejection_reason: Optional[str] = None  # latest reject's reason (mirror of newest log row).
    rejection_notes: Optional[str] = None
    approval_image_url: Optional[str] = None
    rejection_image_url: Optional[str] = None
    rejection_count: int = 0  # times rejected (== len(rejections)); survives reopen.
    rejections: list[LabDipRejectionResponse] = []  # full reject history for traceability.
    dips: list[LabDipLineResponse] = []
    model_config = ConfigDict(from_attributes=True)

class LabDipRequestCreate(BaseModel):
    # 'FG' (finished goods) or 'YARN' (raw material). Picks the numbering book;
    # immutable after create, so there is no counterpart on LabDipRequestUpdate.
    kind: str = "FG"
    customer_id: Optional[UUID] = None
    base_item_id: Optional[UUID] = None
    approved_recipe_id: Optional[UUID] = None
    color_id: Optional[UUID] = None
    request_date: Optional[str] = None
    season: Optional[str] = None
    customer_article_code: Optional[str] = None
    internal_article_code: Optional[str] = None
    substrate: Optional[str] = None
    color_standard: Optional[str] = None
    request_type: str = "NEW"
    due_date: Optional[str] = None
    estimated_completion_date: Optional[str] = None
    notes: Optional[str] = None
    items: list[LabDipItemCreate] = []
    dips: list[LabDipLineCreate] = []

class LabDipRequestUpdate(BaseModel):
    customer_id: Optional[UUID] = None
    base_item_id: Optional[UUID] = None
    approved_recipe_id: Optional[UUID] = None
    color_id: Optional[UUID] = None
    request_date: Optional[str] = None
    season: Optional[str] = None
    customer_article_code: Optional[str] = None
    internal_article_code: Optional[str] = None
    substrate: Optional[str] = None
    color_standard: Optional[str] = None
    request_type: str = "NEW"
    due_date: Optional[str] = None
    estimated_completion_date: Optional[str] = None
    notes: Optional[str] = None
    items: list[LabDipItemUpdate] = []
    dips: list[LabDipLineUpdate] = []

class LabDipRequestResponse(BaseModel):
    id: UUID
    code: str
    kind: str = "FG"
    status: str
    request_type: str = "NEW"
    created_at: datetime
    updated_at: Optional[datetime] = None  # bumped on any item status change; drives default list sort.
    customer_id: Optional[UUID] = None
    base_item_id: Optional[UUID] = None
    approved_recipe_id: Optional[UUID] = None
    color_id: Optional[UUID] = None
    request_date: Optional[date] = None
    season: Optional[str] = None
    customer_article_code: Optional[str] = None
    internal_article_code: Optional[str] = None
    substrate: Optional[str] = None
    color_standard: Optional[str] = None
    due_date: Optional[date] = None
    estimated_completion_date: Optional[date] = None
    notes: Optional[str] = None
    items: list[LabDipItemResponse] = []
    dips: list[LabDipLineResponse] = []
    model_config = ConfigDict(from_attributes=True)

class PaginatedLabDipRequestResponse(BaseModel):
    """`{items, total, page, size}` envelope for GET /lab-dips.

    The route used to return a bare list with a silent limit of 100, so the two lab
    dip pages paginated client-side over only the first 100 rows — request #101 was
    unreachable. `size` keeps the endpoint's historical default of 100.
    """
    items: list[LabDipRequestResponse] = []
    total: int = 0
    page: int = 1
    size: int = 100
    #: Variant-grain tallies over the whole filtered set (not the page) — the list
    #: footer counts variants, which page-local sums would understate.
    variant_counts: dict[str, int] = {}
    #: Page that currently holds `?focus_id=` under the active filters (deep links);
    #: None when no focus was asked for or the row does not match the filters.
    focus_page: Optional[int] = None

# --- Auth Schemas ---

class PermissionBase(BaseModel):
    code: str
    description: str

class PermissionResponse(PermissionBase):
    id: UUID
    class Config:
        from_attributes = True

class RoleBase(BaseModel):
    name: str
    description: str | None = None
    allowed_work_center_types: list[str] | None = None
    allowed_categories: list[str] | None = None
    allowed_locations: list[str] | None = None
    # Avatar template for users in this role who have saved no avatar of their own.
    # On RoleBase (not just RoleResponse) so it rides along on the nested `role` of
    # every UserResponse — which is how the sidebar and user lists resolve a face
    # without a second fetch.
    default_avatar_id: str | None = None

class RoleCreate(RoleBase):
    permission_ids: list[UUID] = []

class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    permission_ids: Optional[list[UUID]] = None
    allowed_work_center_types: Optional[list[str]] = None
    allowed_categories: Optional[list[str]] = None
    allowed_locations: Optional[list[str]] = None
    # Empty string clears the template (a role that constrains nothing); null means
    # "leave it alone", the same convention as every other field here.
    default_avatar_id: Optional[str] = None

class RoleResponse(RoleBase):
    id: UUID
    permissions: list[PermissionResponse] = []
    class Config:
        from_attributes = True

class UserBase(BaseModel):
    username: str
    full_name: str
    role_id: UUID | None = None

class UserCreate(UserBase):
    password: str
    permission_ids: list[UUID] = []
    avatar_id: str | None = None

class UserUpdate(BaseModel):
    username: Optional[str] = None
    full_name: Optional[str] = None
    role_id: Optional[UUID] = None
    permission_ids: Optional[list[UUID]] = None
    password: Optional[str] = None
    avatar_id: Optional[str] = None

class UserResponse(UserBase):
    id: UUID
    role: RoleResponse | None = None
    permissions: list[PermissionResponse] = []
    avatar_id: str | None = None
    is_active: bool = True
    last_login_at: datetime | None = None
    class Config:
        from_attributes = True

class BOMAutomatorProfileCreate(BaseModel):
    name: str
    levels: list[list[str]]
    # Parallel to `levels` — whether each level inherits the root BOM's attribute
    # values. Optional so older clients keep working; missing means "no inheritance".
    inherit_attributes: list[bool] | None = None

class BOMAutomatorProfileResponse(BaseModel):
    id: UUID
    name: str
    levels: list[list[str]]
    inherit_attributes: list[bool] | None = None
    class Config:
        from_attributes = True

class UserPreferenceUpsert(BaseModel):
    value: Any

class UserPreferenceResponse(BaseModel):
    key: str
    value: Any
    class Config:
        from_attributes = True

class DatabaseResponse(BaseModel):
    message: str
    status: bool
    data: Optional[dict] = None

class ConnectionProfile(BaseModel):
    name: str
    url: str
    is_active: bool = False

class WipeDatabaseRequest(BaseModel):
    password: str

class AuditLogResponse(BaseModel):
    id: UUID
    user_id: UUID | None
    action: str
    entity_type: str
    entity_id: str
    details: str | None
    changes: dict | None
    timestamp: datetime
    
    class Config:
        from_attributes = True

class PaginatedAuditLogResponse(BaseModel):
    items: list[AuditLogResponse]
    total: int
    page: int
    size: int

# ── Dyeing & Setting ──────────────────────────────────────────────────

class DyeRecipeLineCreate(BaseModel):
    item_id: UUID
    qty_per_100kg: float | None = None
    qty_per_liter: float | None = None
    uom_id: UUID | None = None
    chemical_type: str = "OTHER"
    sort_order: int = 0

class DyeRecipeLineResponse(DyeRecipeLineCreate):
    id: UUID
    recipe_id: UUID
    item_name: str | None = None
    uom_name: str | None = None
    model_config = ConfigDict(from_attributes=True)

class DyeRecipeWashBathCreate(BaseModel):
    bath_number: int
    # attribute_value_id is the source of truth (system attribute "Wash Bath");
    # description is a snapshot resolved server-side, sent back for display.
    attribute_value_id: UUID | None = None
    description: str = ""

class DyeRecipeWashBathResponse(DyeRecipeWashBathCreate):
    id: UUID
    recipe_id: UUID
    model_config = ConfigDict(from_attributes=True)

class DyeRecipeFinishingCreate(BaseModel):
    # attribute_value_id → system attribute "Finishing Step"; description snapshot
    attribute_value_id: UUID | None = None
    description: str = ""
    sort_order: int = 0

class DyeRecipeFinishingResponse(DyeRecipeFinishingCreate):
    id: UUID
    recipe_id: UUID
    model_config = ConfigDict(from_attributes=True)

class DyeRecipeCreate(BaseModel):
    code: str
    name: str
    attribute_value_ids: list[UUID] = []
    color_standard: str | None = None
    color_id: UUID | None = None
    substrate_type: str | None = None
    liquor_ratio: float | None = None
    notes: str | None = None
    is_active: bool = True
    lines: list[DyeRecipeLineCreate] = []
    wash_baths: list[DyeRecipeWashBathCreate] = []
    finishing_steps: list[DyeRecipeFinishingCreate] = []

class DyeRecipeUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    color_standard: str | None = None
    color_id: UUID | None = None
    substrate_type: str | None = None
    liquor_ratio: float | None = None
    notes: str | None = None
    is_active: bool | None = None
    attribute_value_ids: list[UUID] | None = None
    lines: list[DyeRecipeLineCreate] | None = None
    wash_baths: list[DyeRecipeWashBathCreate] | None = None
    finishing_steps: list[DyeRecipeFinishingCreate] | None = None

class DyeRecipeResponse(BaseModel):
    id: UUID
    code: str
    name: str
    color_standard: str | None = None
    color_id: UUID | None = None
    color_name: str | None = None
    color_code: str | None = None
    color_hex: str | None = None
    color_variant_label: str | None = None
    color_variant_hex: str | None = None
    substrate_type: str | None = None
    liquor_ratio: float | None = None
    notes: str | None = None
    is_active: bool
    created_at: datetime
    attribute_value_ids: list[UUID] = []
    lines: list[DyeRecipeLineResponse] = []
    wash_baths: list[DyeRecipeWashBathResponse] = []
    finishing_steps: list[DyeRecipeFinishingResponse] = []
    model_config = ConfigDict(from_attributes=True)

class PaginatedDyeRecipeResponse(BaseModel):
    items: list[DyeRecipeResponse] = []
    total: int = 0
    page: int = 1
    size: int = 50

class DyeDoseLine(BaseModel):
    """One recipe line weighed out for a specific bath. See dyeing_dose_service."""
    line_id: UUID
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    chemical_type: str | None = None
    sort_order: int = 0
    # PER_LITER (g/L x bath volume) or PER_100KG (owf x substrate). None = the line
    # carries no rate at all, so nothing can be dosed from it.
    basis: str | None = None
    qty_per_liter: float | None = None
    qty_per_100kg: float | None = None
    # None when the input this line's basis needs is still missing (typically the
    # bath volume) — the row is still returned so the UI can say which line is blocked.
    dose: float | None = None
    dose_unit: str | None = None
    dose_kg: float | None = None
    uom_id: UUID | None = None
    uom_name: str | None = None

class DyeDoseResponse(BaseModel):
    recipe_id: UUID
    recipe_code: str | None = None
    recipe_name: str | None = None
    substrate_qty: float | None = None
    bath_volume_liters: float | None = None
    # Derived from the pair above, never a second typed copy (see solve_bath).
    liquor_ratio: float | None = None
    lines: list[DyeDoseLine] = []

class DyeingRunChemicalCreate(BaseModel):
    item_id: UUID
    planned_qty: float
    actual_qty: float
    uom_id: UUID | None = None

class DyeingRunChemicalUpsert(BaseModel):
    """One weighed chemical. `planned_qty` is optional here (unlike the create
    shape): the plan was snapshotted when the bath was filled, and an actual being
    recorded must not overwrite it."""
    item_id: UUID
    actual_qty: float
    planned_qty: float | None = None
    uom_id: UUID | None = None


class DyeingRunChemicalResponse(DyeingRunChemicalCreate):
    id: UUID
    run_id: UUID
    item_name: str | None = None
    uom_name: str | None = None
    model_config = ConfigDict(from_attributes=True)

class DyeingRunCreate(BaseModel):
    """A bath cut by hand. Runs are normally auto-created by WO creation.

    `substrate_qty` is optional and defaults to the WO's own qty. It stays a
    per-run column rather than being read off the WO every time, because a
    multi-bath WO splits its load across runs — but the common case is one bath for
    the whole WO, and a hand-typed copy of a number the WO already holds only
    drifts.

    The customer/order/colour fields this once carried (`customer_name`, `artikel`,
    `po_number`, `qty_order_kg`, `color_name`, `color_matching_ref`, `lot_number`,
    `machine_name`) are gone. They duplicated the SO/MO/WO chain and the colour
    attributes, were never populated in 12 runs of real use, and the machine is
    `work_order.work_center_id` — see migration a7c9e1b3d5f8.
    """
    work_order_id: UUID
    recipe_id: UUID | None = None
    substrate_qty: float | None = None
    input_batch_id: UUID | None = None
    liquor_ratio: float | None = None
    volume_air_liters: float | None = None
    machine_speed: float | None = None
    machine_pressure: str | None = None
    temperature_c: float | None = None
    duration_min: int | None = None
    operator_name: str | None = None
    notes: str | None = None

class DyeingRunMonitorUpdate(BaseModel):
    """The rate inputs the dyeing monitor needs for one batch.

    All optional and applied only when present, so the setup screen may send just
    the rpm without restating a target the supervisor never touched. An empty body
    is a 422, not a silent no-op.
    """
    rpm: float | None = None
    lines: int | None = None
    target_efficiency_pct: float | None = None


class DyeingRunStartPayload(BaseModel):
    """The bath, recorded at the moment it is filled.

    Starting a run is the bath-fill event, so this is where the volume belongs: the
    dose sheet the operator weighs from is calculated off it, and calculating it
    afterwards would make it a record of what should have been weighed rather than
    an instruction for weighing it. Send a volume or a liquor ratio; one must resolve.
    """
    volume_air_liters: float | None = None
    liquor_ratio: float | None = None
    substrate_qty: float | None = None


class DyeingRunBathUpdate(BaseModel):
    """The bath the operator actually filled, set at fill time rather than at run
    creation — the volume is only known once the machine is loaded, and it is what
    every g/L dose is calculated from.

    Send either field: the other is derived (`dyeing_dose_service.solve_bath`).
    `substrate_qty` is here too because a re-weighed load moves both.
    """
    volume_air_liters: float | None = None
    liquor_ratio: float | None = None
    substrate_qty: float | None = None


class DyeingRunChemicalsUpdate(BaseModel):
    """What actually went into the vessel, recorded from the work order flow.

    Separate from `/complete` because the two are different acts by different people:
    the operator at the vessel records the doses they weighed out (with the output
    log), and QC records the shade later. Folding actuals into the close meant the
    only way to record them was to close the bath.

    Upsert by item: a row already on the run keeps its `planned_qty` unless one is
    sent, so recording an actual can never quietly rewrite what the operator was
    told to weigh. Items not listed are left alone (nothing is cleared by omission).
    """
    chemicals: list[DyeingRunChemicalUpsert]


class DyeingRunCompletePayload(BaseModel):
    """Closes the bath — now the shade-result act, and nothing else has to ride on it.

    `chemicals` is **None = leave the recorded doses alone**, which is what the QC
    close sends: actuals are recorded from the work order flow
    (`PATCH /dyeing-runs/{id}/chemicals`) and a shade entry must not wipe them. An
    explicit list still replaces the whole sheet, `[]` included, for the legacy
    all-in-one close.

    `output_batch_number` is legacy and optional. The dyed output lot is minted by
    the WO completion (`add_mo_completion`, the `DYE-` prefix) — one physical dye
    lot, one `Batch` row — and the run adopts it rather than creating a second.
    When given it may only name a lot that already exists; this route never mints.
    """
    shade_result: str | None = None
    shade_notes: str | None = None
    output_batch_number: str | None = None
    chemicals: list[DyeingRunChemicalCreate] | None = None

class DyeingRunResponse(BaseModel):
    id: UUID
    work_order_id: UUID
    run_number: int
    recipe_id: UUID | None = None
    substrate_qty: float
    input_batch_id: UUID | None = None
    output_batch_id: UUID | None = None
    liquor_ratio: float | None = None
    planned_volume_air_liters: float | None = None
    volume_air_liters: float | None = None
    # The bath every dose on screen or on paper is weighed from: the actual once the
    # floor has filled it, the plan until then. Derived server-side so the print
    # portal, the dose sheet and the scan terminal cannot each pick differently.
    effective_bath_liters: float | None = None
    machine_speed: float | None = None
    machine_pressure: str | None = None
    temperature_c: float | None = None
    duration_min: int | None = None
    status: str
    shade_result: str | None = None
    shade_notes: str | None = None
    operator_name: str | None = None
    notes: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    chemicals: list[DyeingRunChemicalResponse] = []
    recipe_name: str | None = None
    input_batch_number: str | None = None
    output_batch_number: str | None = None
    model_config = ConfigDict(from_attributes=True)

class SettingRunCreate(BaseModel):
    work_order_id: UUID
    substrate_qty: float
    input_batch_id: UUID | None = None
    machine_name: str | None = None
    temperature_c: float | None = None
    speed_mpm: float | None = None
    width_cm: float | None = None
    overfeed_pct: float | None = None
    operator_name: str | None = None
    notes: str | None = None

class SettingRunCompletePayload(BaseModel):
    output_batch_number: str
    actual_width_cm: float | None = None
    actual_gsm: float | None = None
    actual_shrinkage_pct: float | None = None

class SettingRunResponse(BaseModel):
    id: UUID
    work_order_id: UUID
    run_number: int
    substrate_qty: float
    input_batch_id: UUID | None = None
    output_batch_id: UUID | None = None
    machine_name: str | None = None
    temperature_c: float | None = None
    speed_mpm: float | None = None
    width_cm: float | None = None
    overfeed_pct: float | None = None
    actual_width_cm: float | None = None
    actual_gsm: float | None = None
    actual_shrinkage_pct: float | None = None
    status: str
    operator_name: str | None = None
    notes: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    input_batch_number: str | None = None
    output_batch_number: str | None = None
    model_config = ConfigDict(from_attributes=True)

# --- Settings Schemas ---
class CompanyProfileBase(BaseModel):
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    logo_url: Optional[str] = None
    tax_id: Optional[str] = None

class CompanyProfileUpdate(CompanyProfileBase):
    pass

class CompanyProfileResponse(CompanyProfileBase):
    id: UUID
    class Config:
        from_attributes = True

class BackupScheduleUpdate(BaseModel):
    enabled: bool
    frequency: str  # "daily" | "weekly"
    day_of_week: Optional[int] = None  # 0=Mon..6=Sun, required when frequency == "weekly"
    hour: int
    minute: int
    timezone: str
    retain_count: int

class BackupScheduleResponse(BaseModel):
    id: UUID
    enabled: bool
    frequency: str
    day_of_week: Optional[int] = None
    hour: int
    minute: int
    timezone: str
    retain_count: int
    last_run_at: Optional[datetime] = None
    last_run_status: Optional[str] = None
    last_run_error: Optional[str] = None
    next_run_at: Optional[datetime] = None
    class Config:
        from_attributes = True

# --- Batch / Lot Schemas ---

class BatchCreate(BaseModel):
    item_id: UUID
    notes: Optional[str] = None
    # Optional opening stock for the new lot. qty > 0 requires a location — a lot
    # with a quantity but nowhere to sit would write a balance row nothing reads.
    qty: Optional[float] = None
    location_id: Optional[UUID] = None

class BatchResponse(BaseModel):
    id: UUID
    batch_number: str
    vendor_lot: Optional[str] = None  # supplier's lot reference (non-unique)
    item_id: UUID
    item_code: Optional[str] = None   # populated by batches endpoints (eager-loaded item)
    item_name: Optional[str] = None
    notes: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    ends: Optional[int] = None
    source_wo_id: Optional[UUID] = None
    # Size identity of the produced lot (sized greige/dyed lots); snapshot carries
    # the human label {size_name, label, target_measurement, ...} for lot displays.
    bom_size_id: Optional[UUID] = None
    bom_size_snapshot: Optional[dict] = None
    quality_status: str = "GOOD"    # GOOD | REJECTED
    quarantine_status: Optional[str] = None  # disposition snapshot; only meaningful when `held` is true
    held: bool = False  # quarantine_status not yet OK AND the batch's current location is a quarantine hold area (populated by list endpoint)
    remaining: Optional[float] = None  # stock balance for this batch (populated by list endpoint)
    location_id: Optional[UUID] = None    # current location — beam is atomic, always at most one (populated by list endpoint)
    location_name: Optional[str] = None
    location_path: Optional[list[str]] = None  # root-first hierarchy [warehouse, zone, bin] for the current leaf location
    # Variant identity of the StockBalance row this lot is held under — sorted
    # attribute-value UUIDs plus a trailing `c:<uuid>` colour token. Compare against
    # PackingOrderResponse.variant_key to tell whether a lot is the shade an order
    # is packing; a lot is one physical thing, so it has exactly one.
    variant_key: Optional[str] = None
    # Origin lineage — resolved from source_wo_id → WO → MO → PR/SO (populated by batches endpoints)
    wo_code: Optional[str] = None
    mo_id: Optional[UUID] = None
    mo_code: Optional[str] = None
    production_run_id: Optional[UUID] = None
    production_run_code: Optional[str] = None
    sales_order_id: Optional[UUID] = None
    sales_order_code: Optional[str] = None
    # Variant identity of the producing MO — combo/colour/material attribute values
    # plus the Color Library shade (or pending lab-dip code). Size is on the lot
    # itself (bom_size_snapshot); these are what distinguish two same-size lots.
    variant_attributes: Optional[list[BatchVariantAttr]] = None
    color_code: Optional[str] = None
    color_name: Optional[str] = None
    color_hex: Optional[str] = None
    labdip_variant_code: Optional[str] = None
    # GR origin — resolved from GoodsReceiptLine → GoodsReceipt → PurchaseOrder
    po_id: Optional[UUID] = None
    po_number: Optional[str] = None
    # Immediate upstream lots this batch was made from (one level back) — e.g. a
    # beam's raw-material/yarn goods-receipt lots. Populated on demand only
    # (with_source_lots=true) so it powers RM-lot visibility at staging.
    source_lots: Optional[list[str]] = None
    # Staging reservation: the WO this lot was staged to at the queried location
    # (services/staging_service.py). Populated only when the caller passes a
    # location_id — a claim is per (lot, location). A consumption picker must not
    # offer a lot whose reserved_wo_id is some other WO: two sizes of one BOM
    # share a machine, so they share an input location and the same substrate item.
    reserved_wo_id: Optional[UUID] = None
    reserved_wo_code: Optional[str] = None
    # Warp beams only: the loom this beam is gaited on right now (active BeamMount).
    # A mounted beam is not free stock — `mount_beam` refuses to double-mount it —
    # so the beam scanner rejects it at the scan and names the machine holding it.
    # The beam-side twin of reserved_wo_id/reserved_wo_code above.
    mounted_wc_id: Optional[UUID] = None
    mounted_wc_code: Optional[str] = None

    class Config:
        from_attributes = True

class PaginatedBatchResponse(BaseModel):
    items: list[BatchResponse]
    total: int
    page: int
    size: int

class BatchConsumptionResponse(BaseModel):
    id: UUID
    manufacturing_order_id: Optional[UUID] = None
    mo_code: Optional[str] = None          # resolved from MO
    packing_order_id: Optional[UUID] = None
    input_batch_id: UUID
    output_batch_id: Optional[UUID] = None
    output_batch_number: Optional[str] = None  # resolved from output Batch
    qty_consumed: float
    created_at: datetime

    class Config:
        from_attributes = True

class BatchTraceBackNode(BaseModel):
    """Backward genealogy: this batch + the input batches it was made from."""
    batch: BatchResponse
    qty_consumed: Optional[float] = None       # qty of THIS batch consumed into the parent node
    manufacturing_order_id: Optional[UUID] = None
    mo_code: Optional[str] = None
    sales_order_code: Optional[str] = None     # originating SO of the MO that consumed this batch
    inputs: list["BatchTraceBackNode"] = []

BatchTraceBackNode.model_rebuild()

class BatchTraceResponse(BaseModel):
    batch: BatchResponse
    consumptions: list[BatchConsumptionResponse]

class MOLineBatchAssignment(BaseModel):
    bom_line_item_id: UUID
    attribute_value_ids: list[UUID] = []
    batch_id: UUID
    qty: float

class MOCompleteWithBatchesPayload(BaseModel):
    output_batch_id: Optional[UUID] = None
    material_batches: list[MOLineBatchAssignment] = []

class POLineBatchAssignment(BaseModel):
    line_id: UUID
    batch_id: UUID

class POReceiveWithBatchesPayload(BaseModel):
    batch_assignments: list[POLineBatchAssignment] = []

# --- Packing Orders (pack FG into cartons — WO-shaped) ---

class PackingOrderMaterialPayload(BaseModel):
    item_id: UUID
    qty_planned: float = 0
    location_id: UUID | None = None
    notes: str | None = None

class PackingOrderCreate(BaseModel):
    item_id: UUID
    # In the item's own UOM. May be omitted (0) when `qty2` is given with a
    # resolvable alt unit — the server then derives it, so the client never has
    # to reproduce the alt -> length -> kg chain.
    qty_target: float = 0
    # Null = pack to stock. When set, only tags the cartons; it does not reserve them.
    sales_order_id: UUID | None = None
    sales_order_line_id: UUID | None = None
    color_id: UUID | None = None
    attribute_value_ids: list[UUID] = []
    # Box size, in the item's UOM. Derived from `pack_size_alt` when that is sent
    # with a resolvable alt unit — the count is what the floor packs to.
    pack_size: float | None = None
    # Box size in the alt selling unit ("12 Pcs per carton"). Wins over
    # `pack_size` whenever the conversion resolves; see PackingOrder.pack_size_alt.
    pack_size_alt: float | None = None
    package_label: str = "Carton"
    # Alt (selling) unit. Omit all three when packing against an SO line and the
    # server snapshots the line's own — that is the normal path, so the packing
    # order counts in whatever the customer ordered in. `uom2_factor` is the qty of
    # one alt unit as the UOM master states it (1 Pcs = 5 yard -> 5), same meaning
    # as on the SO line; `uom2_length_uom` names that unit — usually a length, but
    # `1 Box = 10 kg` is a seeded row too — and is resolved off the UOM master when
    # not sent. See packing_service.base_per_alt.
    qty2: float | None = None
    uom2: str | None = None
    uom2_factor: float | None = None
    uom2_length_uom: str | None = None
    # What one yard/metre of THIS cloth actually weighs, sampled by the operator
    # before packing. Overrides the item master's development estimate for every
    # alt -> kg conversion on this order (see PackingOrder.sample_weight_per_unit).
    # Send both halves or neither; `g/y` and `g/m` only.
    sample_weight_per_unit: float | None = None
    sample_weight_unit: str | None = None
    # 'COUNTED' (pieces counted into the box) or 'WEIGHED' (cut to weight: the
    # scale reading is entered and the piece count is derived through this order's
    # sampled g/y as each carton is logged). See PackingOrder.pack_basis.
    pack_basis: str = "COUNTED"
    source_location_id: UUID | None = None
    output_location_id: UUID | None = None
    # Packing machine (WorkCenter MACHINE row) this order is dispatched to.
    work_center_id: UUID | None = None
    target_start_date: datetime | None = None
    target_end_date: datetime | None = None
    notes: str | None = None
    materials: list[PackingOrderMaterialPayload] = []

class PackingOrderUpdate(BaseModel):
    qty_target: float | None = None
    sales_order_id: UUID | None = None
    sales_order_line_id: UUID | None = None
    color_id: UUID | None = None
    attribute_value_ids: list[UUID] | None = None
    pack_size: float | None = None
    pack_size_alt: float | None = None
    package_label: str | None = None
    qty2: float | None = None
    uom2: str | None = None
    uom2_factor: float | None = None
    uom2_length_uom: str | None = None
    # What one yard/metre of THIS cloth actually weighs, sampled by the operator
    # before packing. Overrides the item master's development estimate for every
    # alt -> kg conversion on this order (see PackingOrder.sample_weight_per_unit).
    # Send both halves or neither; `g/y` and `g/m` only.
    sample_weight_per_unit: float | None = None
    sample_weight_unit: str | None = None
    # 'COUNTED' (pieces counted into the box) or 'WEIGHED' (cut to weight: the
    # scale reading is entered and the piece count is derived through this order's
    # sampled g/y as each carton is logged). See PackingOrder.pack_basis.
    pack_basis: str | None = None
    source_location_id: UUID | None = None
    output_location_id: UUID | None = None
    work_center_id: UUID | None = None
    status: str | None = None
    target_start_date: datetime | None = None
    target_end_date: datetime | None = None
    notes: str | None = None
    materials: list[PackingOrderMaterialPayload] | None = None

class PackingCompletionMaterialPayload(BaseModel):
    item_id: UUID
    qty: float = 0
    location_id: UUID | None = None
    batch_id: UUID | None = None

class PackingCompletionLotPayload(BaseModel):
    """One source lot drawn in a pack event, mirroring a WO staging line.

    The lot pins the exact StockBalance row being packed, so the variant is
    resolved from that row server-side rather than restated by the caller.
    """
    batch_id: UUID
    # Qty that became good cartons. May be 0 when the whole draw was scrapped —
    # the lot then contributes only `qty_rejected`.
    qty: float
    # Cartons minted from this lot; omit to derive from the order's pack_size.
    package_count: int | None = None
    # Loose material drawn off this lot that never became a carton — offcuts,
    # stained ends. Consumed from the source location on top of `qty` and moved
    # into the defect store; no carton, label or QR is minted for it.
    qty_rejected: float = 0

class PackingCompletionCreate(BaseModel):
    # qty/package_count describe the whole event and are ignored when `lots` is
    # given — each lot carries its own. Defaults keep a lots-only payload valid.
    qty: float = 0
    package_count: int = 1
    # Fixed box size driving the carton split (N full boxes + one remainder),
    # e.g. 5 for 5kg boxes. Overrides the order's own pack_size for this event;
    # omit to fall back to pack_size, or to the legacy package_count if neither
    # is set. Applies across every lot in `lots`. Ignored when `boxes` is given.
    box_size: float | None = None
    # The same per-event box size stated in the alt selling unit — "break this draw
    # into 12 Pcs cartons". Wins over `box_size` and over the order's own sizes,
    # and is how an alt-unit order splits: a carton holds a whole number of pieces,
    # while the kilos it works out to are an estimate the scale then contradicts.
    # Ignored when `boxes` is given (the packer stated the boxes themselves).
    box_size_alt: float | None = None
    # Explicit, user-edited box quantities for the whole event (spanning every
    # lot in `lots` combined) — must sum to the total qty being packed. Wins
    # over `box_size`; a box that doesn't fit within one lot's draw is split
    # across the lot boundary (see packing_service.allocate_boxes_to_lots).
    boxes: list[float] | None = None
    # Scale reading per carton, positional against `boxes`, and REQUIRED for every
    # one of them — packing is logged after the boxes are packed and weighed, so a
    # blank prints a label with no N.W. line (rejected by
    # packing_service.assert_all_weighed). Measured, never derived from qty: the
    # same yardage weighs differently per lot. A box split at a lot seam shares
    # its weight pro-rata. The nullable element type only carries the positional
    # gap through to that check, so the error can name which carton is missing.
    box_weights: list[float | None] | None = None
    # Count packed into each carton in the order's alt selling unit (12 Pcs, 4
    # Pic), positional against `boxes`. Optional: omit it and the server derives
    # a count from each carton's base qty. Worth sending because for a kg item the
    # base qty is the SCALE reading, and dividing that by the alt factor gives
    # 11.8 pieces for a box that holds 12. A carton split at a lot seam shares its
    # count so the parts still sum to what was stated.
    box_alt_qtys: list[float | None] | None = None
    # Which packaging type each carton is packed in, positional against `boxes`.
    # Required for every carton (packing_service.assert_all_boxed) — brutto is a
    # printed figure on the label and the delivery note, and a carton with no box
    # has no tare to add. A box split at a lot seam keeps one type: the pieces
    # re-merge into a single physical carton.
    box_packaging_type_ids: list[UUID | None] | None = None
    # Hand-weighed tare per carton, positional against `boxes`. Only meaningful
    # for a type flagged `is_custom` — a custom box has no master tare, so the
    # packer weighs the empty box. Ignored (the master's tare wins) for every
    # other type, so a stale value from a re-picked row cannot leak onto a
    # standard box.
    box_tares: list[float | None] | None = None
    source_batch_id: UUID | None = None
    # Multi-lot pack: one completion row is written per lot, so each keeps a
    # truthful source_batch_id and its own carton range.
    lots: list[PackingCompletionLotPayload] | None = None
    # Loose scrap for the single-event path (ignored when `lots` is given — each
    # lot states its own). Material that left the source location but never
    # became a carton, so it counts against qty_rejected and never against
    # qty_packed. `reason` and the defect-store override apply to the whole
    # event either way.
    qty_rejected: float = 0
    reject_reason: str | None = None
    # Defect store override; omitted resolves through reject_service (item
    # master default — packing has no work center to inherit from).
    reject_location_id: UUID | None = None
    # Machine this pack event ran on. Omitted = the packing order's own machine;
    # never left null when the order names one, so per-machine output is readable.
    work_center_id: UUID | None = None
    operator: str | None = None
    notes: str | None = None
    # Omit to fall back to the order's planned materials, pro-rated by qty.
    # With `lots`, explicit materials attach to the first lot's completion.
    materials: list[PackingCompletionMaterialPayload] | None = None

class PackingOrderMaterialResponse(BaseModel):
    id: UUID
    item_id: UUID
    item_name: str | None = None
    item_code: str | None = None
    item_uom: str | None = None
    qty_planned: float
    qty_consumed: float = 0
    location_id: UUID | None = None
    notes: str | None = None
    class Config:
        from_attributes = True

class PackingCompletionMaterialResponse(BaseModel):
    id: UUID
    item_id: UUID
    item_name: str | None = None
    item_code: str | None = None
    qty: float
    location_id: UUID | None = None
    batch_id: UUID | None = None
    class Config:
        from_attributes = True

class PackedUnitResponse(BaseModel):
    id: UUID
    batch_number: str
    item_id: UUID
    item_name: str | None = None
    item_code: str | None = None
    package_no: int | None = None
    package_label: str | None = None
    weight_kg: float | None = None
    qty: float = 0
    # Count in the packing order's alt selling unit that went into this carton
    # (12 Pcs, 4 Pic). Stored on the carton, not divided out of `qty` at read
    # time: for a kg item `qty` is the scale reading. See models/batch.py.
    alt_qty: float | None = None
    # --- Packaging / brutto -------------------------------------------------
    # The box this carton is packed in, the tare snapshotted from it at pack
    # time, and net + tare. All three are stored on the carton (see
    # models/batch.py) so a later edit of the master never rewrites a printed
    # label or a delivery note's weight.
    packaging_type_id: UUID | None = None
    packaging_type_name: str | None = None
    packaging_type_code: str | None = None
    tare_kg: float | None = None
    gross_weight_kg: float | None = None
    location_id: UUID | None = None
    location_name: str | None = None
    packing_order_id: UUID | None = None
    packing_order_code: str | None = None
    # Which pack event minted this carton — lets the QC reject flow offer the
    # cartons of one log entry instead of the whole order's.
    packing_completion_id: UUID | None = None
    # Soft tag: what this carton was packed for. Any pick list may still take it.
    packed_for_so_id: UUID | None = None
    quality_status: str = "GOOD"
    created_at: datetime | None = None

    # --- Variant identity ---------------------------------------------------
    # A carton is a lot and must label itself like one: these are the same field
    # names `LotChips` reads on a batch, so one component labels both.
    #
    # Shade / combo / other attributes are NOT stored on the carton's Batch row —
    # they live in the StockBalance row keyed by this carton (`variant_key`), the
    # same place its qty lives, so there is no second copy to drift. They are
    # resolved onto the response at read time (stock_service.describe_variant_keys).
    variant_key: str | None = None
    variant_attributes: list[dict] | None = None
    color_id: UUID | None = None
    color_name: str | None = None
    color_code: str | None = None
    color_hex: str | None = None
    # Size is the exception: it is never folded into `variant_key`, so it is
    # copied onto the carton off its source lot at mint time and read from the
    # Batch row here (packing_service.lot_size_identity).
    bom_size_id: UUID | None = None
    bom_size_snapshot: dict | None = None
    size_label: str | None = None
    class Config:
        from_attributes = True

class PackingCompletionResponse(BaseModel):
    id: UUID
    qty: float
    package_count: int
    source_batch_id: UUID | None = None
    source_batch_number: str | None = None
    work_center_id: UUID | None = None
    work_center_name: str | None = None
    operator_user_id: UUID | None = None
    operator: str | None = None
    operator_full_name: str | None = None
    notes: str | None = None
    completed_at: datetime
    # QC reject — same split as MOCompletionResponse
    rejected: bool = False
    qty_rejected: float = 0
    package_count_rejected: int = 0
    reject_reason: str | None = None
    rejected_at: datetime | None = None
    rejected_by: str | None = None
    reject_location_id: UUID | None = None
    materials: list[PackingCompletionMaterialResponse] = []
    class Config:
        from_attributes = True

class PackingCompletionReject(BaseModel):
    """QC-reject cartons off one pack event. Omit `packed_unit_ids` to reject the
    whole event (every carton it minted); name cartons to reject only those."""
    reason: str | None = None
    packed_unit_ids: list[UUID] = []
    # Defect store override; omitted = resolved from the FG item's default.
    reject_location_id: UUID | None = None
    usable: bool = False

class PackingOrderResponse(BaseModel):
    id: UUID
    code: str
    sales_order_id: UUID | None = None
    sales_order_line_id: UUID | None = None
    sales_order_code: str | None = None
    # The customer's own PO reference — printed above our SO number on the
    # carton label's PO. NO line, which is what the customer's goods-in reads.
    customer_po_ref: str | None = None
    customer_name: str | None = None
    item_id: UUID
    item_name: str | None = None
    item_code: str | None = None
    item_uom: str | None = None
    # Alt selling unit — the order's own columns, snapshotted from the SO line at
    # create time (the migration that added the columns backfilled the ones already
    # on the floor). `uom2_factor` is the qty of one alt unit as the UOM master
    # states it, `uom2_length_uom` names that unit, and `uom2_base_factor` is the
    # resolved BASE-UOM qty per alt unit — served rather than left to the client so
    # the pack screens and the carton label share the server's one conversion.
    qty2: float | None = None
    uom2: str | None = None
    uom2_factor: float | None = None
    uom2_length_uom: str | None = None
    uom2_base_factor: float | None = None
    # The sampled weight spec `uom2_base_factor` was computed through, when the
    # order has one — so a screen can say which basis its kilos came from.
    sample_weight_per_unit: float | None = None
    sample_weight_unit: str | None = None
    # 'COUNTED' (pieces counted into the box) or 'WEIGHED' (cut to weight: the
    # scale reading is entered and the piece count is derived through this order's
    # sampled g/y as each carton is logged). See PackingOrder.pack_basis.
    pack_basis: str = "COUNTED"
    # "Keterangan stock" free text on the SO line, printed alongside CONTENT.
    ket_stock: str | None = None
    color_id: UUID | None = None
    color_name: str | None = None
    color_code: str | None = None
    color_hex: str | None = None
    # Size the SO line was raised for, decorated from `sales_order_line.bom_size`.
    # The order itself carries no size (a run may pack several — see the model),
    # so this is the plan; what the cartons were stamped with is on each unit.
    size_label: str | None = None
    attribute_value_ids: list[UUID] = []
    # The order's variant identity in StockBalance form (attribute UUIDs + `c:<uuid>`).
    # Empty string = the order declares no variant, so any lot of the item at the
    # source location is fair game. Served rather than rebuilt client-side so the
    # lot picker's match uses the same key the stock rows are written under.
    variant_key: str = ""
    qty_target: float
    qty_packed: float = 0
    # `qty_packed` restated in the alt selling unit — SUMMED from each carton's own
    # stated count, never divided out of the kilos. The kilos are scale readings and
    # an elastic cloth does not weigh what its g/y predicted, so the derived figure
    # drifts with the fabric while this one counts pieces. None when the order has no
    # alt unit. See `api/packing._packed_alt_qty`.
    qty_packed_alt: float | None = None
    package_count: int = 0
    # Scrap rolled up across completions (QC-rejected cartons)
    qty_rejected: float = 0
    package_count_rejected: int = 0
    pack_size: float | None = None
    # Box size in the alt selling unit, and the one the pack screens split by when
    # it is set — `pack_size` is its weight estimate. See PackingOrder.pack_size_alt.
    pack_size_alt: float | None = None
    package_label: str
    source_location_id: UUID | None = None
    output_location_id: UUID | None = None
    work_center_id: UUID | None = None
    work_center_name: str | None = None
    status: str
    target_start_date: datetime | None = None
    target_end_date: datetime | None = None
    actual_start_date: datetime | None = None
    actual_end_date: datetime | None = None
    notes: str | None = None
    card_printed_at: datetime | None = None
    created_at: datetime
    materials: list[PackingOrderMaterialResponse] = []
    completions: list[PackingCompletionResponse] = []
    packed_units: list[PackedUnitResponse] = []
    class Config:
        from_attributes = True

class PackingOrderListResponse(BaseModel):
    items: list[PackingOrderResponse]
    total: int
    page: int
    size: int

# --- Pick Lists (outbound Surat Jalan / dispatch) ---

class PickListLinePayload(BaseModel):
    sales_order_line_id: UUID
    item_id: UUID
    qty_picked: float = 0
    source_location_id: UUID | None = None
    # The carton (PackedUnit batch) this line pulls; null for bulk ship lines.
    batch_id: UUID | None = None

class PickListCreate(BaseModel):
    sales_order_id: UUID
    source_location_id: UUID | None = None
    # Empty -> server suggests cartons FIFO for every outstanding SO line.
    lines: list[PickListLinePayload] = []

class PickListUpdate(BaseModel):
    source_location_id: UUID | None = None
    status: str | None = None
    qc_passed: bool | None = None
    qc_inspector: str | None = None
    # Surat Jalan fields (DN number, delivery date, carrier, vehicle, driver) are
    # NOT accepted here any more — they belong to the Shipment that stages this
    # pick list at the loading deck. Accepting them in both places was two sources
    # of truth for one printed document.
    notes: str | None = None
    lines: list[PickListLinePayload] | None = None

class PickListScanPayload(BaseModel):
    """Picker scanned a carton QR — confirms the suggested line, or appends one."""
    code: str
    picked_by: str | None = None

class PickListLineResponse(BaseModel):
    id: UUID
    sales_order_line_id: UUID
    item_id: UUID
    item_name: str | None = None
    item_code: str | None = None
    item_uom: str | None = None
    qty_picked: float
    source_location_id: UUID | None = None
    batch_id: UUID | None = None
    batch_number: str | None = None
    package_no: int | None = None
    picked_at: datetime | None = None
    picked_by: str | None = None
    # Surat Jalan "WARNA" column — decorated from the SO line, not stored here.
    color_name: str | None = None
    color_code: str | None = None
    attribute_value_ids: list[UUID] = []
    # The picked CARTON's own size, off its Batch row. Colour above is what was
    # ordered; this is what is physically in the box, and it is the one identity
    # a picker cannot recover from the SO line when an order runs several sizes.
    bom_size_snapshot: dict | None = None
    size_label: str | None = None
    # The picked carton's packaging and weights, decorated off its Batch row.
    # Brutto is what the carrier bills on, so the pick list and the Surat Jalan
    # both have to be able to total it without reopening the packing order.
    packaging_type_name: str | None = None
    net_weight_kg: float | None = None
    gross_weight_kg: float | None = None
    class Config:
        from_attributes = True

class PickListResponse(BaseModel):
    id: UUID
    code: str
    sales_order_id: UUID
    sales_order_code: str | None = None
    customer_po_ref: str | None = None
    customer_name: str | None = None
    source_location_id: UUID | None = None
    status: str
    qc_passed: bool
    qc_inspector: str | None = None
    qc_at: datetime | None = None
    # Legacy Surat Jalan fields, read-only: populated only on rows dispatched
    # before the Shipment split. Live delivery-note data comes off the shipment.
    delivery_note_number: str | None = None
    delivery_date: datetime | None = None
    carrier: str | None = None
    vehicle_plate: str | None = None
    driver: str | None = None
    shipment_id: UUID | None = None
    shipment_code: str | None = None
    shipment_status: str | None = None
    notes: str | None = None
    dispatched_at: datetime | None = None
    created_at: datetime
    lines: list[PickListLineResponse] = []
    class Config:
        from_attributes = True

class PickListListResponse(BaseModel):
    items: list[PickListResponse]
    total: int
    page: int
    size: int


# ── Shipment (loading deck / Surat Jalan) ──────────────────────────────────
# One shipment = one printed delivery note = one customer, 1..n pick lists.
# See models/shipment.py for why the note lives here and not on PickList.

class ShipmentCreate(BaseModel):
    pick_list_ids: list[UUID]
    delivery_note_number: str | None = None
    delivery_date: datetime | None = None
    carrier: str | None = None
    vehicle_plate: str | None = None
    driver: str | None = None
    notes: str | None = None

class ShipmentUpdate(BaseModel):
    # None = leave alone. An empty list on pick_list_ids does mean "unload
    # everything", so it is distinguishable from omitting the field.
    pick_list_ids: list[UUID] | None = None
    delivery_note_number: str | None = None
    delivery_date: datetime | None = None
    carrier: str | None = None
    vehicle_plate: str | None = None
    driver: str | None = None
    notes: str | None = None

class ShipmentVerifyPayload(BaseModel):
    """The deck check. Deliberately carries no identity field — the verifier is
    the authenticated user, so the four-eyes rule cannot be typed around."""
    notes: str | None = None
    with_discrepancy: bool = False

class ShipmentPickListRef(BaseModel):
    """A member pick list, carrying enough to print the Surat Jalan without a
    second round trip."""
    id: UUID
    code: str
    sales_order_id: UUID
    sales_order_code: str | None = None
    customer_po_ref: str | None = None
    customer_name: str | None = None
    status: str
    qc_passed: bool
    carton_count: int = 0
    total_qty: float = 0
    lines: list[PickListLineResponse] = []
    class Config:
        from_attributes = True

class ShipmentResponse(BaseModel):
    id: UUID
    code: str
    delivery_note_number: str | None = None
    delivery_date: datetime | None = None
    customer_name: str | None = None
    carrier: str | None = None
    vehicle_plate: str | None = None
    driver: str | None = None
    status: str
    # *_name are decorated, not columns — deliberately NOT named after the
    # relationships (`staged_by`), which would overwrite a loaded User instance
    # with a string on the ORM object and dirty the session.
    staged_at: datetime | None = None
    staged_by_name: str | None = None
    verified_at: datetime | None = None
    verified_by_name: str | None = None
    verification_notes: str | None = None
    verified_with_discrepancy: bool = False
    dispatched_at: datetime | None = None
    notes: str | None = None
    created_at: datetime
    created_by_name: str | None = None
    pick_lists: list[ShipmentPickListRef] = []
    carton_count: int = 0
    total_qty: float = 0
    class Config:
        from_attributes = True

class ShipmentListResponse(BaseModel):
    items: list[ShipmentResponse]
    total: int
    page: int
    size: int

class StageablePickListResponse(BaseModel):
    """One row of the loading-deck board: a PICKED pick list not yet on any
    shipment, i.e. work waiting for a loader."""
    id: UUID
    code: str
    sales_order_id: UUID
    sales_order_code: str | None = None
    customer_po_ref: str | None = None
    customer_name: str | None = None
    qc_passed: bool
    carton_count: int = 0
    total_qty: float = 0
    picked_at: datetime | None = None


class PickableOrderLine(BaseModel):
    """One outstanding line of a pickable order: what is actually ordered, in the
    same identity language a lot labels itself with (`LotChips` on the frontend
    reads these field names).

    The board row above is per ORDER, but a picker releasing it needs to know
    which item and which shade/size it covers — two lines of the same item
    differing only by colour or size are otherwise indistinguishable on the
    board, and "ready 235" says nothing about which of them is ready."""
    sales_order_line_id: UUID
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    item_uom: str | None = None
    qty_outstanding: float = 0
    qty_ready: float = 0
    cartons_ready: int = 0
    # Ordered variant identity, resolved from this line's own stock variant key
    # (attributes + Color Library shade) plus its BOM size.
    size_label: str | None = None
    variant_attributes: list[BatchVariantAttr] | None = None
    color_id: UUID | None = None
    color_code: str | None = None
    color_name: str | None = None
    color_hex: str | None = None
    # Ordered against a shade still in lab dip — no Color row exists yet.
    labdip_variant_code: str | None = None


class PickableOrderResponse(BaseModel):
    """One row of the pick readiness board: an open order, when it is due, and
    how much of what it still owes is already sitting packed in cartons."""
    id: UUID
    po_number: str
    customer_po_ref: str | None = None
    customer_name: str
    status: str
    # Earliest outstanding line due date — when the customer expects delivery.
    due_date: datetime | None = None
    # Negative = overdue. None when the order carries no due date at all.
    days_to_due: int | None = None
    line_count: int = 0
    lines_outstanding: int = 0
    qty_outstanding: float = 0
    # Qty covered by whole cartons available now; may overshoot qty_outstanding
    # on the last carton, since a carton is never split.
    qty_ready: float = 0
    cartons_ready: int = 0
    has_open_pick_list: bool = False
    # --- Whole-order fulfilment (so_fulfilment_service.fulfilment_map) ---------
    # Coverage above answers "of what this order still OWES, how much is packed
    # and waiting"; these answer "where does the WHOLE order stand" — an order
    # 90% shipped and one 0% shipped both read 100% coverage on their last
    # carton, and only this pair tells them apart.
    #
    # Summed over every line, in each line's own stock UoM — the same mixed-unit
    # sum `qty_outstanding`/`qty_ready` above already are. `base_uom` is set only
    # when every line agrees on one unit, so a mixed order labels the figure with
    # no unit rather than the wrong one.
    qty_ordered_base: float = 0
    qty_made: float = 0
    qty_packed: float = 0
    qty_dispatched: float = 0
    base_uom: str | None = None
    # The same roll-up in the alt selling unit, which is what the board draws —
    # the customer is owed pieces, not kilos. Summed only over lines that count in
    # ONE unit: `alt_uom` is null when the order mixes Pcs and Pic (or when any
    # contributing line has no alt unit at all), and the row then falls back to the
    # base figures rather than adding two unlike counts into one number.
    qty_ordered_alt: float | None = None
    qty_made_alt: float | None = None
    qty_packed_alt: float | None = None
    qty_dispatched_alt: float | None = None
    alt_uom: str | None = None
    # Lines whose ordered qty can't be restated in the stock UoM (weight-stocked
    # item with no weight-per-yard on its master). They contribute nothing to the
    # four numbers above, so the bar understates the order — it is drawn with a
    # warning rather than silently.
    lines_unknown_base: int = 0
    # Per-line breakdown of the same numbers, so the board can show what the
    # order is made of. Must be declared here or response_model drops it.
    lines: list[PickableOrderLine] = []


class PickListSuggestedCarton(BaseModel):
    """One FIFO-suggested carton, not yet on any pick list."""
    batch_id: UUID
    batch_number: str | None = None
    package_no: int | None = None
    qty: float
    source_location_id: UUID | None = None
    # The box's count in the line's alt selling unit — `Batch.alt_qty`, what the
    # packer counted into it, never `qty / uom2_factor`. Null when the carton was
    # packed without one, or the line has no alt unit at all; the row then reads
    # in stock UoM alone.
    alt_qty: float | None = None
    alt_uom: str | None = None

    # --- Variant identity ---------------------------------------------------
    # Same field names as PackedUnitResponse / a lot, so `LotChips` labels a
    # suggested carton exactly as the carton list and the Kartu Packing do.
    # Shade/combo/attributes live in the carton's StockBalance row (`variant_key`),
    # size on its Batch row; neither is stored twice. Resolved at read time.
    variant_key: str | None = None
    variant_attributes: list[BatchVariantAttr] | None = None
    color_id: UUID | None = None
    color_name: str | None = None
    color_code: str | None = None
    color_hex: str | None = None
    bom_size_id: UUID | None = None
    bom_size_snapshot: dict | None = None
    size_label: str | None = None


class PickListSuggestedLine(BaseModel):
    """Preview of what `create_pick_list` would auto-fill for one SO line —
    lets the planner uncheck a carton (e.g. one that overshoots what's still
    owed) before anything is written to a pick list."""
    sales_order_line_id: UUID
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    item_uom: str | None = None
    ordered_qty: float = 0
    remaining_qty: float = 0
    # The same two in the line's alt selling unit (`SalesOrderLine.uom2` — Pcs,
    # Pic, Gross): the figure the customer ordered in and is owed in. None means
    # the line has no alt unit, which is a different answer from zero and is what
    # makes the modal fall back to kilos alone.
    ordered_alt: float | None = None
    remaining_alt: float | None = None
    alt_uom: str | None = None
    # What the LINE ordered (shade/combo/size), against which the cartons below
    # carry what is physically in each box — they can differ, and the planner
    # unchecking a carton is exactly who needs to see that.
    size_label: str | None = None
    variant_attributes: list[BatchVariantAttr] | None = None
    color_id: UUID | None = None
    color_code: str | None = None
    color_name: str | None = None
    color_hex: str | None = None
    labdip_variant_code: str | None = None
    cartons: list[PickListSuggestedCarton] = []

# ── Work-Center Performance Monitoring (weaving runs + production calendar) ──

class WeavingRunCreate(BaseModel):
    work_center_id: UUID
    # Either is enough: pass work_order_id and the MO is derived from it. mo_id
    # alone still works for a loom with no WO dispatched (the pre-WO shape).
    mo_id: UUID | None = None
    work_order_id: UUID | None = None
    lines: int = 1
    rate_per_line_g_min: float = 5
    target_efficiency_pct: float = 50
    start_date: date
    notes: str | None = None

class WeavingRunUpdate(BaseModel):
    lines: int | None = None
    rate_per_line_g_min: float | None = None
    target_efficiency_pct: float | None = None
    actual_qty_override: float | None = None
    status: str | None = None
    end_date: date | None = None
    notes: str | None = None

class WeavingRunResponse(BaseModel):
    id: UUID
    work_center_id: UUID
    mo_id: UUID
    work_order_id: UUID | None = None
    lines: int
    rate_per_line_g_min: float
    target_efficiency_pct: float
    start_date: date
    end_date: date | None = None
    status: str
    actual_qty_override: float | None = None
    notes: str | None = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class WeavingRunPauseRequest(BaseModel):
    """Park a run. `reason` is what the floor answers "why did this WO slip" with."""
    reason: str | None = None

class WeavingRunPauseResponse(BaseModel):
    id: UUID
    run_id: UUID
    paused_on: date
    resumed_on: date | None = None
    reason: str | None = None
    paused_by: str | None = None
    resumed_by: str | None = None
    model_config = ConfigDict(from_attributes=True)

class WorkCenterHolidayCreate(BaseModel):
    holiday_date: date
    note: str | None = None

class WorkCenterHolidayResponse(BaseModel):
    id: UUID
    work_center_id: UUID
    holiday_date: date
    note: str | None = None
    model_config = ConfigDict(from_attributes=True)

class WorkCenterCalendarUpdate(BaseModel):
    working_weekdays: list[int]  # 0=Mon .. 6=Sun

class WorkCenterGroupCalendarUpdate(BaseModel):
    """Batch calendar applied to every machine under a TYPE/GROUP node.

    Cascade-copy: each machine keeps its own rows, written from this payload in one
    transaction. `holidays=None` leaves machine holidays untouched (weekdays only);
    a list replaces them wholesale so the group is the visible source of truth.
    """
    working_weekdays: list[int]
    holidays: list[WorkCenterHolidayCreate] | None = None
    import_national_year: int | None = None

# ── Print Templates ────────────────────────────────────────────────────────────
# `layout` / `paper` are opaque to the backend — the frontend TemplateRenderer is
# the only interpreter. Typed as Any so a new band type never needs a schema change.

class PrintTemplateSave(BaseModel):
    layout: dict[str, Any]
    paper: dict[str, Any] | None = None

class PrintTemplateResponse(BaseModel):
    id: UUID
    doc_type: str
    layout: dict[str, Any]
    paper: dict[str, Any] | None = None
    updated_by_id: UUID | None = None
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

# ── Quarantine Packing ─────────────────────────────────────────────────────────
# QC hold desk between production output and packing. The disposition lives on
# the LOT so a partially-passed MO can release its good lots; the group row is a
# derived rollup, never stored. See services/quarantine_service.py for the gate.

class QuarantineStatusOption(BaseModel):
    id: UUID
    value: str
    # True for the one disposition that releases a lot to packing ("OK"). The
    # value list is client-extensible; this flag is not — it comes from code.
    is_pass: bool

class QuarantineLotResponse(BaseModel):
    # Null on un-lotted stock held in quarantine: it is shown so nothing on hold
    # is invisible, but it cannot be dispositioned.
    batch_id: UUID | None = None
    batch_number: str | None = None
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    qty: float
    location_id: UUID | None = None
    location_name: str | None = None
    variant_key: str = ''
    quality_status: str | None = None
    quarantine_status: str | None = None
    quarantine_status_id: UUID | None = None
    quarantine_status_at: datetime | None = None
    quarantine_status_by: str | None = None
    quarantine_notes: str | None = None
    released: bool = False
    # Consumed by a packing completion — the disposition is frozen from here on.
    packed: bool = False
    # How much of the lot packing has drawn. Set on any packed lot; on a lot with
    # nothing left on hand (`qty == 0`) it is the only quantity there is to show,
    # which is what the "Show packed" history rows are.
    qty_packed: float | None = None
    last_packed_at: datetime | None = None
    created_at: datetime | None = None
    # Variant identity, same shape as BatchResponse/LotChips everywhere else:
    # size lives on the lot itself, combo/colour on the producing MO's attribute
    # values (color_code/name/hex + labdip_variant_code mirror the group's own,
    # since a group is one MO — shown per-lot too so the lot list reads standalone).
    bom_size_snapshot: dict | None = None
    variant_attributes: list[BatchVariantAttr] | None = None
    color_code: str | None = None
    color_name: str | None = None
    color_hex: str | None = None
    labdip_variant_code: str | None = None
    # How much of this lot an open packing order has allocated to itself — the
    # order's OPEN quantity (`qty_target - qty_packed`), spread FIFO across the
    # lots it could draw from, never the whole pool it points at. `qty -
    # claimed_qty` is what is still free to plan a new order against; a lot may be
    # partly claimed, which is why this is a quantity and not a flag.
    claimed_qty: float = 0
    # The order that claimed it (first claimant when two orders split one lot).
    # A label for the UI — `claimed_qty` is the figure that decides anything.
    claimed_by_order_code: str | None = None
    # The WO that produced this lot (`Batch.source_wo_id`). The group already
    # rolls up to one MO, but a group can span several WOs (e.g. re-dyeing runs),
    # so this is only ever meaningful per lot, not per group.
    wo_code: str | None = None

class QuarantineGroupResponse(BaseModel):
    # "<mo_id|unassigned>:<item_id>" — an MO can output several items and an item
    # can arrive from several MOs, so the row is one (order, product) pair.
    key: str
    mo_id: UUID | None = None
    mo_code: str | None = None
    mo_status: str | None = None
    mo_qty: float | None = None
    production_run_code: str | None = None
    sales_order_id: UUID | None = None
    sales_order_code: str | None = None
    color_id: UUID | None = None
    color_code: str | None = None
    color_name: str | None = None
    color_hex: str | None = None
    labdip_variant_code: str | None = None
    # The MO's combo attribute value, if this FG is combo-typed (see
    # Item.variant_type) — color and combo are both order/production-level
    # picks, never baked into item_id, so matching on item_id alone conflates
    # every colour/combo of the same style.
    combo_value_id: UUID | None = None
    # The MO's sized-BOM pick, if any — lets the Packing form auto-match this
    # group to the one open SO line ordered in the same size/colour/combo.
    bom_size_id: UUID | None = None
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    # On-hand figures only — a lot packed out of the hold area no longer counts
    # towards any of these three, however it is listed.
    qty_total: float = 0
    qty_released: float = 0
    # Released stock already allocated to an open packing order's open quantity.
    # `qty_released - qty_claimed` is what a new packing order can still be
    # planned against, and is what the Pack button offers.
    qty_claimed: float = 0
    lot_count: int = 0
    # Listed history rows (only when `include_packed`), counted apart so the
    # held columns above stay a picture of what is physically on the desk.
    packed_lot_count: int = 0
    # NONE (nothing dispositioned) | MIXED (lots disagree) | PACKED (nothing left
    # on hand) | the shared status.
    rollup_status: str = 'NONE'
    status_counts: dict[str, int] = {}
    lots: list[QuarantineLotResponse] = []

class QuarantineListResponse(BaseModel):
    items: list[QuarantineGroupResponse]
    total: int
    page: int
    size: int
    # True when the scan hit MAX_LOT_ROWS — said out loud rather than showing a
    # partial hold list as if it were everything.
    truncated: bool = False

class QuarantineStatusUpdate(BaseModel):
    batch_ids: list[UUID]
    # Null clears the disposition, re-holding the lots.
    status_value_id: UUID | None = None
    notes: str | None = None


# ---------------------------------------------------------------------------
# Work-center dispatch queue (services/work_queue_service.py)
# ---------------------------------------------------------------------------

class WorkQueueMaterial(BaseModel):
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    # Item.uom is a plain string on the item, so every qty on this row reads in it.
    uom: str | None = None
    required_qty: float = 0
    staged_qty: float = 0
    # Free pool at the moment THIS work order's turn came in the priority walk,
    # not the raw plant total — higher-priority orders have already taken theirs.
    on_hand_qty: float = 0
    allocated_qty: float = 0
    shortfall_qty: float = 0
    is_beam: bool = False
    # The one material that decides the row's verdict (greige, yarn, warp beam).
    # Auxiliary chemicals are reported but never block the order.
    is_substrate: bool = False
    mounted_pcs: int = 0
    required_pcs: int = 0
    incoming_qty: float = 0
    incoming_mo_code: str | None = None
    incoming_eta: datetime | None = None


class WorkQueueRow(BaseModel):
    # Null on an unreleased row: the order exists, the work order does not.
    work_order_id: UUID | None = None
    work_order_code: str | None = None
    work_order_name: str | None = None
    status: str
    sequence: int | None = None
    staging_status: str = 'NOT_STAGED'
    is_released: bool = True
    # How an unreleased row's work centre was decided: routing (read from
    # BOMOperation) | colour | beam (inferred from the order's output) | unknown.
    # Blank on released rows.
    release_hint_source: str = ''
    work_center_id: UUID | None = None
    work_center_name: str | None = None
    work_center_type: str | None = None
    mo_id: UUID
    mo_code: str | None = None
    item_code: str | None = None
    item_name: str | None = None
    color_name: str | None = None
    qty: float = 0
    target_start_date: datetime | None = None
    # The date the row is queued on, and which planning field it came from:
    # wo_start | wo_end | mo_start | mo_end | so_due | created. `created` means the
    # order was never scheduled and the queue fell back to order-entry (FIFO) order.
    priority_date: datetime | None = None
    date_source: str = 'created'
    # Past its planned date and not yet started. Never set when date_source is
    # 'created' — an unscheduled order cannot be late.
    is_overdue: bool = False
    # RUNNING | STAGED | READY | PARTIAL | WAITING_UPSTREAM
    # | SHORT | NO_MATERIALS | NOT_RELEASED
    verdict: str
    verdict_detail: str | None = None
    substrate_item_code: str | None = None
    # Always the item's base UOM, beam rows included: what the order actually eats
    # vs what is actually there. Beam readiness is still a pcs gate internally (a
    # warp is up or it isn't) but slot counts are not reported here — the planner
    # asked for the substrate requirement, not the loom's slot config.
    substrate_is_beam: bool = False
    substrate_uom: str | None = None
    substrate_required_qty: float = 0
    substrate_available_qty: float = 0
    chemical_shortfall_count: int = 0
    materials: list[WorkQueueMaterial] = []


class WorkQueueLot(BaseModel):
    batch_id: str | None = None
    batch_number: str | None = None
    qty: float = 0
    location_name: str | None = None


class WorkQueueMaterialSummary(BaseModel):
    """Stock-side companion to the order list: per gating material (greige, yarn),
    how much the queue has claimed and how much is still free, with the lots."""
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    uom: str | None = None
    on_hand_qty: float = 0
    required_total: float = 0
    allocated_total: float = 0
    staged_total: float = 0
    free_qty: float = 0
    shortfall_total: float = 0
    orders_total: int = 0
    orders_waiting: int = 0
    lot_count: int = 0
    lots: list[WorkQueueLot] = []


class WorkQueueResponse(BaseModel):
    items: list[WorkQueueRow]
    total: int
    page: int
    size: int
    # Row count per verdict across the WHOLE queue, not the current page — the
    # tab badges ("3 ready, 2 short") must not change when the PIC pages.
    counts: dict[str, int] = {}
    # How many rows are late, and how many carry no planned date at all. The second
    # is a data-quality signal the PIC must see: a queue where most rows fall back
    # to order-entry order is not really a schedule, and saying so beats implying
    # a precision that isn't there.
    overdue_count: int = 0
    undated_count: int = 0
    # Open orders with no work order at all — work the floor cannot start and a
    # WO-grain list would never show.
    unreleased_count: int = 0
    sort: str = 'date'
    materials: list[WorkQueueMaterialSummary] = []


# ── Production quantity formula (Settings) ───────────────────────────────────

class QtyFormulaRuleIO(BaseModel):
    """One size's expression. `size_name` is a standard Size name or "*" for
    the fallback row."""
    size_name: str
    expression: str

    model_config = ConfigDict(from_attributes=True)


class QtyFormulaUpdate(BaseModel):
    # Full replace, not a patch: the rule set is read as a whole by the
    # Production Run modal, so a partial write would leave a formula nobody
    # authored (half old rows, half new).
    rules: list[QtyFormulaRuleIO]


class QtyFormulaResponse(BaseModel):
    rules: list[QtyFormulaRuleIO]
    # Shipped so the editor's "Reset to default" and the modal's fallback don't
    # each hardcode their own copy of the original hardcoded formula.
    defaults: list[QtyFormulaRuleIO]
    sizes: list[str] = []
    functions: list[str] = []
    fallback: str = "*"
    self_name: str = "qty"
