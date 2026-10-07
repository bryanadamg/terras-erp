"""A malformed id in the path is the caller's mistake: 422, never a 500."""

def test_malformed_id_is_a_422_not_a_500(client, auth_headers):
    res = client.get("/api/manufacturing-orders/not-a-uuid", headers=auth_headers)
    assert res.status_code == 422, res.text
