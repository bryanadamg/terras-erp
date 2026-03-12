from pydantic import BaseModel
from uuid import UUID
from datetime import datetime
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
    values: list[AttributeValueResponse] = []

    class Config:
        from_attributes = True

class BOMLineCreate(BaseModel):
    item_code: str
    attribute_value_ids: list[UUID] = []
    qty: float
    is_percentage: bool = False
    source_location_code: str | None = None

class BOMLineResponse(BaseModel):
    id: UUID
    item_id: UUID
    item_code: str | None = None
    item_name: str | None = None
    attribute_value_ids: list[UUID] = [] # We'll populate this in the API
    qty: float
    is_percentage: bool = False
    source_location_id: UUID | None = None

    class Config:
        from_attributes = True

class BOMOperationCreate(BaseModel):
    operation_id: UUID
    work_center_id: UUID | None = None
    sequence: int = 10
    time_minutes: float = 0.0

class BOMOperationResponse(BaseModel):
    id: UUID
    operation_id: UUID
    work_center_id: UUID | None
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

    class Config:
        from_attributes = True

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

class ItemUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    uom: str | None = None
    category: str | None = None
    attribute_ids: list[UUID] | None = None
    source_sample_id: UUID | None = None
    active: bool | None = None

class ItemResponse(ItemCreate):
    id: UUID
    active: bool

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
    attribute_value_ids: list[UUID] = []

class SalesOrderLineResponse(SalesOrderLineCreate):
    id: UUID
    attribute_value_ids: list[UUID] = []
    class Config:
        from_attributes = True

class SalesOrderCreate(BaseModel):
    po_number: str
    customer_name: str
    order_date: datetime | None = None
    lines: list[SalesOrderLineCreate]

class SalesOrderResponse(BaseModel):
    id: UUID
    po_number: str
    customer_name: str
    order_date: datetime
    status: str
    delivered_at: datetime | None = None
    lines: list[SalesOrderLineResponse]
    created_at: datetime
    class Config:
        from_attributes = True

# --- Sample Request Schemas ---

class SampleRequestCreate(BaseModel):
    sales_order_id: Optional[UUID] = None
    base_item_id: UUID
    attribute_value_ids: list[UUID] = []
    notes: Optional[str] = None

class SampleRequestResponse(SampleRequestCreate):
    id: UUID
    code: str
    version: int
    status: str
    created_at: datetime
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

class UserResponse(UserBase):
    id: UUID
    role: RoleResponse | None = None
    permissions: list[PermissionResponse] = []
    allowed_categories: list[str] | None = None
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
