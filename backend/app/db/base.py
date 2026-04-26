from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import MetaData

class Base(DeclarativeBase):
    metadata = MetaData(
        naming_convention={
            "pk": "pk_%(table_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "ix": "ix_%(table_name)s_%(column_0_name)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
        }
    )

# Import all models here so they are registered with Base.metadata
from app.models.item import Item, item_attributes
from app.models.location import Location
from app.models.attribute import Attribute, AttributeValue
from app.models.category import Category
from app.models.size import Size
from app.models.bom import BOM, BOMLine, bom_values, bom_line_values, BOMOperation, BOMSize
from app.models.production_run import ProductionRun
from app.models.manufacturing import ManufacturingOrder, manufacturing_order_values
from app.models.work_order import WorkOrder
from app.models.stock_ledger import StockLedger, stock_ledger_values
from app.models.variant import Variant
from app.models.routing import WorkCenter, Operation
from app.models.auth import Permission, Role, User, role_permissions, user_permissions
from app.models.uom import UOM
from app.models.sales import SalesOrder, SalesOrderLine
from app.models.sample import SampleRequest, SampleColor, sample_attribute_values, SampleRequestRead
from app.models.audit import AuditLog
from app.models.kpi import KPICache
from app.models.partner import Partner
from app.models.purchase import PurchaseOrder, PurchaseOrderLine, purchase_order_line_values
from app.models.stock_balance import StockBalance, stock_balance_values
from app.models.settings import CompanyProfile
