"""Tuning is logged with the tuner's name and closed by the run start, so the
tuning report can say who tuned which loom and how long it took."""
from tests.test_beam_prep import _seed_beam


def test_tuning_needs_a_name_and_the_run_start_closes_it(client, auth_headers, async_db_session):
    from tests.test_dyeing_output_lot import _setup_dyeing_wo
    mo_id, _wo, _runs = _setup_dyeing_wo(client, auth_headers, async_db_session, runs=0)
    loom_id, beam_id = _seed_beam(client, async_db_session)
    res = client.post(f"/api/work-centers/{loom_id}/beam-mounts", json={"batch_id": beam_id, "prep": {
        "prep_type": "DRAW_IN", "ends": 3200, "operator": "Pak Udin"}}, headers=auth_headers)
    assert res.status_code == 200, res.text
    prep = f"/api/work-centers/{loom_id}/loom-prep"
    assert client.post(prep, json={"status": "DRAW_IN"}, headers=auth_headers).status_code == 200
    assert client.post(prep, json={"status": "TUNING"}, headers=auth_headers).status_code == 422

    def mine():
        return [r for r in client.get("/api/weaving/tunings", headers=auth_headers).json()
                if r["work_center_code"].startswith("LM-") and r["tuner_name"] in ("Pak Joko", "Bu Sri")]

    # A reset out of TUNING was a mis-click: its row goes.
    assert client.post(prep, json={"status": "TUNING", "tuner_name": "Pak Joko"}, headers=auth_headers).status_code == 200
    assert client.post(prep, json={"status": None}, headers=auth_headers).status_code == 200
    assert not [r for r in mine() if r["tuner_name"] == "Pak Joko"]

    assert client.post(prep, json={"status": "DRAW_IN"}, headers=auth_headers).status_code == 200
    assert client.post(prep, json={"status": "TUNING", "tuner_name": " Bu Sri "}, headers=auth_headers).status_code == 200
    open_row = next(r for r in mine() if r["tuner_name"] == "Bu Sri")
    assert open_row["ended_at"] is None

    res = client.post("/api/weaving-runs", json={"work_center_id": loom_id, "mo_id": mo_id,
                                                 "start_date": "2026-11-24"}, headers=auth_headers)
    assert res.status_code == 200, res.text
    row = next(r for r in mine() if r["id"] == open_row["id"])
    assert row["ended_at"] is not None and row["duration_hours"] is not None

