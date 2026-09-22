from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.schemas import PartnerCreate, PartnerResponse, PartnerUpdate, PaginatedPartnerResponse
from app.models.partner import Partner
from app.models.audit import AuditLog
from app.core.ws_manager import broadcast_sync
from app.api.auth import get_current_user, require_permission, require_any_permission, user_has_permission
from app.core.pagination import PageParams, PageWindow
from app.models.auth import User
from typing import List, Optional
import uuid

router = APIRouter(prefix="/partners", tags=["partners"])

@router.post("", response_model=PartnerResponse)
def create_partner(payload: PartnerCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    required = 'customer.create' if str(payload.type).upper().endswith('CUSTOMER') else 'supplier.create'
    if not user_has_permission(current_user, required):
        raise HTTPException(status_code=403, detail=f"Missing permission: {required}")
    partner = Partner(
        name=payload.name,
        address=payload.address,
        contact_person=payload.contact_person,
        phone=payload.phone,
        fax=payload.fax,
        email=payload.email,
        type=payload.type,
        active=payload.active
    )
    db.add(partner)
    db.commit()
    db.refresh(partner)
    db.add(AuditLog(user_id=current_user.id, action="CREATE", entity_type="partner", entity_id=str(partner.id), details=f"Created partner {partner.name}"))
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "partners"})
    return partner

@router.get("", response_model=PaginatedPartnerResponse)
def get_partners(
    type: Optional[str] = None,
    active: Optional[bool] = None,
    search: Optional[str] = None,
    # default_size stays at the old hand-rolled `limit=1000` so every caller that
    # sends no window keeps the exact page it got before. max_size is raised to
    # match, because the default `max_size=500` only caps *explicit* sizes and
    # would silently halve a caller that spells out `limit=1000`.
    window: PageWindow = Depends(PageParams(default_size=1000, max_size=1000)),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """One page of the partner directory. For name resolution / dropdowns use
    GET /partners/lookup instead — this route is a window, not the whole set."""
    query = db.query(Partner)
    count_query = db.query(func.count(Partner.id))
    # Scoped by `type` only: the classic status bar reports "N total / N active"
    # for the whole directory of that type, not the searched/filtered page.
    type_scope = db.query(func.count(Partner.id))

    if type:
        query = query.filter(Partner.type == type)
        count_query = count_query.filter(Partner.type == type)
        type_scope = type_scope.filter(Partner.type == type)
    if active is not None:
        query = query.filter(Partner.active == active)
        count_query = count_query.filter(Partner.active == active)
    if search:
        # Mirrors what PartnersView filtered client-side: name OR address.
        like = f"%{search}%"
        cond = or_(Partner.name.ilike(like), Partner.address.ilike(like))
        query = query.filter(cond)
        count_query = count_query.filter(cond)

    total = count_query.scalar() or 0
    items = window.apply(query.order_by(Partner.name)).all()
    return window.envelope(
        items, total,
        type_total=type_scope.scalar() or 0,
        type_active=type_scope.filter(Partner.active == True).scalar() or 0,  # noqa: E712
    )


@router.get("/lookup")
def get_partners_lookup(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Every partner, columns only, no page window — the name-resolution index.

    Declared BEFORE the dynamic `/{partner_id}` routes so "lookup" is not captured
    as a path param (same precedent as GET /items/lookup).

    Returns the full column set rather than an id/name pair: the consumers of
    DataContext's shared `partners` feed include the PO print modal (contact_person,
    address, phone, fax, email) and the SO/Surat-Jalan modals (address), so a
    trimmed payload would blank out printed documents. All nine columns are scalar
    and the table is small — no eager loads, no relationships.
    """
    rows = db.query(
        Partner.id, Partner.name, Partner.type, Partner.active,
        Partner.address, Partner.contact_person, Partner.phone, Partner.fax, Partner.email,
    ).order_by(Partner.name).all()
    return [
        {
            "id": str(r.id), "name": r.name, "type": r.type, "active": r.active,
            "address": r.address, "contact_person": r.contact_person,
            "phone": r.phone, "fax": r.fax, "email": r.email,
        }
        for r in rows
    ]

@router.put("/{partner_id}", response_model=PartnerResponse)
def update_partner(partner_id: uuid.UUID, payload: PartnerUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = db.query(Partner).filter(Partner.id == partner_id).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")

    required = 'customer.edit' if str(partner.type).upper().endswith('CUSTOMER') else 'supplier.edit'
    if not user_has_permission(current_user, required):
        raise HTTPException(status_code=403, detail=f"Missing permission: {required}")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(partner, key, value)

    db.add(AuditLog(user_id=current_user.id, action="UPDATE", entity_type="partner", entity_id=str(partner.id), details=f"Updated partner {partner.name}"))
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "partners"})
    db.refresh(partner)
    return partner

@router.delete("/{partner_id}")
def delete_partner(partner_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = db.query(Partner).filter(Partner.id == partner_id).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")

    required = 'customer.delete' if str(partner.type).upper().endswith('CUSTOMER') else 'supplier.delete'
    if not user_has_permission(current_user, required):
        raise HTTPException(status_code=403, detail=f"Missing permission: {required}")

    try:
        db.add(AuditLog(
            user_id=current_user.id,
            action="DELETE",
            entity_type="partner",
            entity_id=str(partner.id),
            details=f"Deleted partner {partner.name}"
        ))
        db.delete(partner)
        db.commit()
        broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "partners"})
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Cannot delete '{partner.name}': they are referenced by existing records")
    return {"status": "success"}
