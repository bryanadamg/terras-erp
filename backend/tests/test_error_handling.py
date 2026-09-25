from pydantic import BaseModel

from app.main import app


class _Body(BaseModel):
    qty: int


def _boom():
    raise RuntimeError("kaboom")


def _needs_body(body: _Body):
    return body


app.add_api_route("/api/_test/boom", _boom, methods=["GET"])
app.add_api_route("/api/_test/validate", _needs_body, methods=["POST"])


def test_validation_error_detail_is_a_string(client):
    res = client.post("/api/_test/validate", json={"qty": "many"})
    assert res.status_code == 422
    body = res.json()
    assert isinstance(body["detail"], str) and body["detail"].startswith("qty: ")
    assert body["errors"][0]["loc"] == ["body", "qty"]


def test_unhandled_error_is_json_500_with_cors(client):
    res = client.get("/api/_test/boom", headers={"Origin": "http://localhost:3030"})
    assert res.status_code == 500
    body = res.json()
    assert body["detail"] == f"Internal server error (ref {body['error_id']})"
    assert res.headers["access-control-allow-origin"] == "http://localhost:3030"
