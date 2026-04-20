from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.auth import User
from app.schemas import AuditLogResponse
from app.api.auth import get_current_user
from typing import Optional

router = APIRouter()

from app.schemas import AuditLogResponse, PaginatedAuditLogResponse # Add Paginated schema

@router.get("/audit-logs", response_model=PaginatedAuditLogResponse)
def get_audit_logs(
    skip: int = 0,
    limit: int = 100,
    entity_type: Optional[str] = Query(None),
    entity_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(AuditLog)
    
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if entity_id:
        query = query.filter(AuditLog.entity_id == entity_id)
        
    total = query.count()
    items = query.order_by(AuditLog.timestamp.desc()).offset(skip).limit(limit).all()
    
    return {
        "items": items,
        "total": total,
        "page": (skip // limit) + 1,
        "size": len(items)
    }
