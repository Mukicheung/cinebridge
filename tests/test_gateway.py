import json

import httpx
import pytest

from cinebridge import connectors
from cinebridge.core import Store
from cinebridge.engine import Engine


def test_gateway_kind_and_engine(tmp_path):
    store = Store(tmp_path)
    c = store.save_connection(
        {
            "name": "Gateway",
            "kind": "gateway",
            "config": {"url": "https://gateway.example", "token": "client-token"},
        }
    )
    assert not c["config"].get("token")
    adapter = Engine(store).source(store.connection(c["id"], private=True))
    assert type(adapter).__name__ == "GatewaySource"
    adapter.http.close()


def test_gateway_search_resolve_allowlist():
    assert hasattr(connectors, "GatewaySource"), "generic gateway connector missing"

    def handle(r):
        assert r.headers["Authorization"] == "Bearer client-token"
        if r.url.path == "/v1/search":
            assert json.loads(r.content) == {"query": "Test"}
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "title": "Test",
                            "name": "Test.2024.1080p",
                            "year": 2024,
                            "resolution": 1080,
                            "ref": "opaque-reference",
                            "path": "private-path",
                            "raw_url": "https://private.invalid",
                        }
                    ]
                },
            )
        assert json.loads(r.content) == {"ref": "opaque-reference"}
        return httpx.Response(200, json={"magnet": "magnet:?xt=urn:btih:" + "a" * 40})

    src = connectors.GatewaySource(
        {"url": "https://gateway.example", "token": "client-token"},
        httpx.Client(transport=httpx.MockTransport(handle)),
    )
    result = src.search("Test")
    assert "path" not in result[0] and "raw_url" not in result[0]
    assert src.resolve(result[0]).endswith("a" * 40)


@pytest.mark.parametrize("status", [401, 410, 429, 502])
def test_gateway_error_is_sanitized(status):
    assert hasattr(connectors, "GatewaySource")
    src = connectors.GatewaySource(
        {"url": "https://gateway.example", "token": "client-token"},
        httpx.Client(
            transport=httpx.MockTransport(lambda r: httpx.Response(status, text="private endpoint secret"))
        ),
    )
    with pytest.raises(ValueError) as err:
        src.search("Test")
    assert "private endpoint" not in str(err.value)


def test_gateway_enforces_tls_and_has_no_upstream_config(tmp_path):
    store = Store(tmp_path)
    for config in [{"url": "http://gateway.example"}, {"url": "https://gateway.example", "root": "/private"}]:
        with pytest.raises(ValueError):
            store.save_connection({"kind": "gateway", "name": "Gateway", "config": config})


def test_gateway_web_api_and_edit_preserve_only_client_secret(tmp_path):
    from fastapi.testclient import TestClient

    from cinebridge.app import create_app

    app = create_app(tmp_path, worker=False)
    c = TestClient(app)
    body = {
        "name": "Cloud",
        "kind": "gateway",
        "config": {"url": "https://gateway.example", "token": "owner-client-secret"},
    }
    r = c.post("/api/connections", json=body)
    assert r.status_code == 200
    assert "owner-client-secret" not in r.text
    body.update(id=r.json()["id"], config={"url": "https://gateway.example"})
    assert c.post("/api/connections", json=body).status_code == 200
    saved = app.state.store.connection(body["id"], private=True)["config"]
    assert saved == {"url": "https://gateway.example", "token": "owner-client-secret"}
    body["config"]["root"] = "/private"
    assert c.post("/api/connections", json=body).status_code == 400
