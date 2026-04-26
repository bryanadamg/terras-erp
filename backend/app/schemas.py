from pydantic import BaseModel
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
    size_id: UUID
    target_measurement: float | None = None
    measurement_min: float | None = None
    measurement_max: float | None = None

class BOMSizeResponse(BaseModel):
    id: UUID
    size_id: UUID
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
    qty: float
    is_percentage: bool = False
    percentage: float = 0.0
    source_location_code: str | None = None

class BOMLineResponse(BaseModel):
    id: UUID
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    attribute_value_ids: list[UUID] = [] # We'll populate this in the API
    qty: float
    is_percentage: bool = False
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
    lines: list[BOMLineCreate]
    operations: list[BOMOperationCreate] = []
    sizes: list[BOMSizeCreate] = []
    kerapatan_picks: float | None = None
    kerapatan_unit: str | None = None
    sisir_no: int | None = None
    pemakaian_obat: str | None = None
    pembuatan_sample_oleh: str | None = None
    sample_photo_url: str | None = None
    customer_id: Optional[UUID] = None
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
    customer_id: Optional[UUID] = None
    customer_name: Optional[str] = None
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

class WorkOrderCreate(BaseModel):
    code: str
    bom_id: UUID
    location_code: str
    source_location_code: str | None = None
    sales_order_id: UUID | None = None
    qty: float
    target_start_date: datetime | None = None
    target_end_date: datetime | None = None
    create_nested: bool = False # Prompt user to create child WOs

class WorkOrderResponse(BaseModel):
    id: UUID
    code: str
    bom_id: UUID
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    sales_order_id: UUID | None = None
    parent_wo_id: UUID | None = None
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
    
    # We need to include BOM data for expansion
    bom: Optional[BOMResponse] = None
    child_wos: list['WorkOrderResponse'] = []

    class Config:
        from_attributes = True

# To avoid circular reference issues with Pydantic
WorkOrderResponse.update_forward_refs()

class PaginatedWorkOrderResponse(BaseModel):
    items: list[WorkOrderResponse]
    total: int
    page: int
    size: int

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

class LocationCreate(BaseModel):
    code: str
    name: str

class LocationResponse(LocationCreate):
    id: UUID

    class Config:
        from_attributes = True

class UOMCreate(BaseModel):
    name: str

class UOMResponse(UOMCreate):
    id: UUID

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
    attribute_value_ids: list[UUID] = []

class SalesOrderLineResponse(SalesOrderLineCreate):
    id: UUID
    attribute_value_ids: list[UUID] = []
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
