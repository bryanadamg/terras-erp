from pydantic import BaseModel
from pydantic import ConfigDict
from uuid import UUID
from datetime import datetime, date
from typing import Optional

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

class AttributeValueUpdate(BaseModel):
    value: str

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

class BOMLineResponse(BaseModel):
    id: UUID
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    attribute_value_ids: list[UUID] = [] # We'll populate this in the API
    qty: float
    percentage: float = 0.0
    source_location_id: UUID | None = None

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

    class Config:
        from_attributes = True

class BOMCreate(BaseModel):
    code: str
    description: str | None = None
    item_code: str
    attribute_value_ids: list[UUID] = []
    qty: float = 1.0
    tolerance_percentage: float = 0.0
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

class MOCompletionCreate(BaseModel):
    qty_completed: float
    operator_name: str | None = None
    notes: str | None = None

class MOCompletionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    mo_id: UUID
    qty_completed: float
    operator_name: str | None = None
    notes: str | None = None
    created_at: datetime

class ManufacturingOrderCreate(BaseModel):
    code: str
    bom_id: UUID
    location_code: str
    source_location_code: str | None = None
    sales_order_id: UUID | None = None
    qty: float
    production_run_id: UUID | None = None
    bom_size_id: UUID | None = None
    target_start_date: datetime | None = None
    target_end_date: datetime | None = None
    create_nested: bool = False # Prompt user to create child MOs

class BatchConsumptionInMO(BaseModel):
    input_batch_id: UUID
    input_batch_number: str
    output_batch_id: Optional[UUID] = None
    output_batch_number: Optional[str] = None
    qty_consumed: float

class ManufacturingOrderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    bom_id: UUID
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    sales_order_id: UUID | None = None
    sales_order_code: str | None = None
    parent_mo_id: UUID | None = None
    production_run_id: UUID | None = None
    bom_size_id: UUID | None = None
    attribute_value_ids: list[UUID] = [] # We'll populate this in the API
    location_id: UUID
    source_location_id: UUID | None = None
    qty: float
    status: str
    target_start_date: datetime | None
    target_end_date: datetime | None
    actual_start_date: datetime | None
    actual_end_date: datetime | None
    created_at: datetime
    is_material_available: bool = True # Calculated field
    qty_completed_total: float = 0.0  # Populated in API

    # We need to include BOM data for expansion
    bom: Optional[BOMResponse] = None
    child_mos: list['ManufacturingOrderResponse'] = []
    work_orders: list['WorkOrderResponse'] = []
    batch_trace: list[BatchConsumptionInMO] = []
    completions: list[MOCompletionResponse] = []

# Forward refs resolved after WorkOrderResponse is defined below

class PaginatedManufacturingOrderResponse(BaseModel):
    items: list[ManufacturingOrderResponse]
    total: int
    page: int
    size: int

# --- Production Run Schemas ---

class ProductionRunSizeEntry(BaseModel):
    bom_size_id: UUID
    qty: float

class ProductionRunCreate(BaseModel):
    code: str
    bom_id: UUID
    location_code: str
    source_location_code: str | None = None
    sales_order_id: UUID | None = None
    target_start_date: datetime | None = None
    target_end_date: datetime | None = None
    notes: str | None = None
    sizes: list[ProductionRunSizeEntry] = []

class ProductionRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    code: str
    bom_id: UUID
    sales_order_id: UUID | None = None
    location_id: UUID
    source_location_id: UUID | None = None
    status: str
    notes: str | None = None
    target_start_date: datetime | None = None
    target_end_date: datetime | None = None
    actual_start_date: datetime | None = None
    actual_end_date: datetime | None = None
    created_at: datetime
    bom: Optional['BOMResponse'] = None
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
    required_qty: float

class PRMaterialRequirementItem(BaseModel):
    item_id: UUID
    item_code: str
    item_name: str
    uom: str
    attribute_value_ids: list[UUID]
    location_id: UUID
    total_required: float
    qty_available: float
    shortfall: float
    mo_contributions: list[PRMOContribution]

# --- Work Order (operation step) Schemas ---

class WorkOrderCreate(BaseModel):
    manufacturing_order_id: UUID
    sequence: int = 1
    name: str
    work_center_id: UUID | None = None
    planned_duration_hours: float | None = None
    notes: str | None = None
    target_start_date: datetime | None = None
    target_end_date: datetime | None = None

class WorkOrderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    manufacturing_order_id: UUID
    sequence: int
    name: str
    work_center_id: UUID | None = None
    work_center_name: str | None = None
    status: str
    planned_duration_hours: float | None = None
    actual_duration_hours: float | None = None
    notes: str | None = None
    target_start_date: datetime | None = None
    target_end_date: datetime | None = None
    actual_start_date: datetime | None = None
    actual_end_date: datetime | None = None
    created_at: datetime

# Resolve forward references now that all referenced schemas are defined
ManufacturingOrderResponse.update_forward_refs()

class ItemCreate(BaseModel):
    code: str
    name: str
    uom: str
    category: str | None = None
    attribute_ids: list[UUID] = []
    source_sample_id: UUID | None = None
    source_color_id: UUID | None = None
    weight_per_unit: float | None = None
    weight_unit: str | None = None

class ItemUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    uom: str | None = None
    category: str | None = None
    attribute_ids: list[UUID] | None = None
    source_sample_id: UUID | None = None
    source_color_id: UUID | None = None
    active: bool | None = None
    weight_per_unit: float | None = None
    weight_unit: str | None = None

class ItemResponse(ItemCreate):
    id: UUID
    active: bool
    # Populated by the API layer from eager-loaded relationships
    source_sample_code: str | None = None
    source_color_name: str | None = None

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

class StockLedgerResponse(BaseModel):
    id: UUID
    item_id: UUID
    attribute_value_ids: list[UUID] = []
    location_id: UUID
    qty_change: float
    reference_type: str
    reference_id: str
    created_at: datetime

    class Config:
        from_attributes = True

class PaginatedStockLedgerResponse(BaseModel):
    items: list[StockLedgerResponse]
    total: int
    page: int
    size: int

class StockBalanceResponse(BaseModel):
    item_id: UUID
    attribute_value_ids: list[UUID] = []
    location_id: UUID
    qty: float
    batch_key: str = ""

class LocationCreate(BaseModel):
    code: str
    name: str

class LocationResponse(LocationCreate):
    id: UUID

    class Config:
        from_attributes = True

class UOMCreate(BaseModel):
    name: str

class UOMFactorCreate(BaseModel):
    value: float
    label: str | None = None

class UOMFactorResponse(UOMFactorCreate):
    id: UUID
    uom_id: UUID

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

class CategoryResponse(CategoryCreate):
    id: UUID

    class Config:
        from_attributes = True

class WorkCenterCreate(BaseModel):
    code: str
    name: str
    description: str | None = None
    cost_per_hour: float = 0.0

class WorkCenterResponse(WorkCenterCreate):
    id: UUID

    class Config:
        from_attributes = True

class OperationCreate(BaseModel):
    code: str
    name: str
    description: str | None = None

class OperationResponse(OperationCreate):
    id: UUID

    class Config:
        from_attributes = True

# --- Partner (Customer/Supplier) Schemas ---

class PartnerCreate(BaseModel):
    name: str
    address: Optional[str] = None
    type: str # CUSTOMER or SUPPLIER
    active: bool = True

class PartnerUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    active: Optional[bool] = None

class PartnerResponse(PartnerCreate):
    id: UUID
    class Config:
        from_attributes = True

# --- Purchase Order (Outgoing) Schemas ---

class PurchaseOrderLineCreate(BaseModel):
    item_id: UUID
    qty: float
    unit_price: float | None = None
    due_date: datetime | None = None
    attribute_value_ids: list[UUID] = []

class PurchaseOrderLineResponse(PurchaseOrderLineCreate):
    id: UUID
    attribute_value_ids: list[UUID] = []
    class Config:
        from_attributes = True

class PurchaseOrderCreate(BaseModel):
    po_number: str
    supplier_id: UUID | None = None
    target_location_id: UUID | None = None
    order_date: datetime | None = None
    lines: list[PurchaseOrderLineCreate]

class PurchaseOrderResponse(PurchaseOrderCreate):
    id: UUID
    status: str
    lines: list[PurchaseOrderLineResponse]
    created_at: datetime
    class Config:
        from_attributes = True

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
    bom_size_id: UUID | None = None

class SalesOrderLineResponse(SalesOrderLineCreate):
    id: UUID
    attribute_value_ids: list[UUID] = []
    bom_size_id: UUID | None = None

    class Config:
        from_attributes = True

class SalesOrderCreate(BaseModel):
    po_number: str
    customer_po_ref: str | None = None
    customer_name: str
    order_date: datetime | None = None
    lines: list[SalesOrderLineCreate]

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
    class Config:
        from_attributes = True

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
    class Config:
        from_attributes = True

class SampleRequestCreate(BaseModel):
    customer_id: Optional[UUID] = None
    request_date: Optional[str] = None
    project: Optional[str] = None
    customer_article_code: Optional[str] = None
    internal_article_code: Optional[str] = None
    width: Optional[str] = None
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
    class Config:
        from_attributes = True

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

class RoleCreate(RoleBase):
    permission_ids: list[UUID] = []

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
    pass

class UserUpdate(BaseModel):
    username: Optional[str] = None
    full_name: Optional[str] = None
    role_id: Optional[UUID] = None
    permission_ids: Optional[list[UUID]] = None
    allowed_categories: Optional[list[str]] = None
    password: Optional[str] = None
    avatar_id: Optional[str] = None

class UserResponse(UserBase):
    id: UUID
    role: RoleResponse | None = None
    permissions: list[PermissionResponse] = []
    allowed_categories: list[str] | None = None
    avatar_id: str | None = None
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

# --- Batch / Lot Schemas ---

class BatchCreate(BaseModel):
    item_id: UUID
    notes: Optional[str] = None

class BatchResponse(BaseModel):
    id: UUID
    batch_number: str
    item_id: UUID
    notes: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class BatchConsumptionResponse(BaseModel):
    id: UUID
    manufacturing_order_id: UUID
    input_batch_id: UUID
    output_batch_id: Optional[UUID] = None
    qty_consumed: float
    created_at: datetime

    class Config:
        from_attributes = True

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
