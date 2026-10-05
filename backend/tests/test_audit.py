def test_audit_logging(client, auth_headers):
    # Perform an action
    client.post("/api/uoms", json={"name": "AuditUnit"}, headers=auth_headers)
    
    # Check Logs
    res = client.get("/api/audit-logs", headers=auth_headers)
    assert res.status_code == 200
    # Paginated envelope, not a bare list — `logs[0]` on the response dict raised
    # KeyError (and `len(dict) > 0` passed vacuously by counting its keys).
    body = res.json()
    logs = body["items"]
    assert body["total"] > 0
    assert len(logs) > 0

    # Verify latest log
    latest = logs[0]
    assert latest["action"] == "CREATE"
    assert "AuditUnit" in str(latest["changes"]) or "AuditUnit" in latest["details"]


def test_log_activity_leaves_caller_transaction_alone(client, async_db_session):
    """commit=False must not commit the caller's pending work, and a failed audit
    write must not roll it back."""
    import uuid
    from sqlalchemy import select
    from app.models.audit import AuditLog
    from app.models.category import Category
    from app.services import audit_service

    async def run():
        db = async_db_session
        # Pending work audited before the caller's commit, then abandoned.
        cat = Category(name=f"audit-a-{uuid.uuid4().hex[:6]}")
        db.add(cat)
        await audit_service.log_activity(db, None, "CREATE", "Category", cat.id, commit=False)
        await db.rollback()
        assert (await db.execute(select(Category).filter(Category.id == cat.id))).first() is None
        assert (await db.execute(select(AuditLog).filter(AuditLog.entity_id == str(cat.id)))).first() is None

        # A failing audit (unknown user FK) must leave the caller's work in place.
        cat2 = Category(name=f"audit-b-{uuid.uuid4().hex[:6]}")
        db.add(cat2)
        await audit_service.log_activity(db, uuid.uuid4(), "CREATE", "Category", cat2.id, commit=False)
        assert (await db.execute(select(Category).filter(Category.id == cat2.id))).first() is not None

    client.portal.call(run)
