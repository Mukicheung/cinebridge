import importlib.util

from fastapi.testclient import TestClient


def app(tmp_path):
    assert importlib.util.find_spec("cinebridge.app"), "authenticated API missing"
    from cinebridge.app import create_app

    application = create_app(tmp_path, worker=False)
    return TestClient(application), application.state.store.token


def test_api_requires_auth_and_denies_cross_origin(tmp_path):
    c, token = app(tmp_path)
    assert c.get("/healthz").status_code == 200
    assert c.get("/api/overview").status_code == 401
    h = {"Authorization": "Bearer " + token}
    assert c.get("/api/overview", headers=h).status_code == 200
    assert c.post("/api/import", headers=dict(h, Origin="https://evil.example"), json={}).status_code == 403
    assert c.get("/").status_code == 200


def test_import_search_download_and_secret_redaction(tmp_path):
    c, token = app(tmp_path)
    c.headers["Authorization"] = "Bearer " + token
    conn = c.post(
        "/api/connections",
        json={
            "name": "CD2",
            "kind": "cd2",
            "config": {"url": "http://localhost:19798", "token": "never-return-this", "root": "/115/Movies"},
        },
    )
    assert conn.status_code == 200
    assert "never-return-this" not in c.get("/api/connections").text
    r = c.post("/api/import", json={"title": "Example Film", "magnet": "magnet:?xt=urn:btih:" + "ab" * 20})
    assert r.status_code == 200
    results = c.get("/api/search", params={"q": "Example"}).json()["items"]
    assert len(results) == 1
    body = {"resource_id": results[0]["id"], "downloader_id": conn.json()["id"]}
    task = c.post("/api/tasks", json=body).json()
    assert task["status"] == "queued"
    assert c.post("/api/tasks", json=body).json()["id"] == task["id"]
    assert c.post("/api/tasks/" + task["id"] + "/cancel").json()["status"] == "cancelled"
    assert c.get("/api/library").json() == []


def test_subscription_does_not_allow_client_to_set_baseline(tmp_path):
    c, token = app(tmp_path)
    c.headers["Authorization"] = "Bearer " + token
    r = c.post(
        "/api/subscriptions",
        json={"name": "Mine", "user_id": "example", "statuses": ["wish"], "initialized": True},
    )
    assert r.status_code == 422
    assert (
        c.post(
            "/api/subscriptions", json={"name": "Mine", "user_id": "../bad", "statuses": ["wish"]}
        ).status_code
        == 422
    )


def test_browser_page_contains_real_application_shell(tmp_path):
    c, _ = app(tmp_path)
    html = c.get("/").text
    assert "CineBridge" in html
    assert "/static/app.js" in html
    assert c.get("/static/app.js").status_code == 200


def test_validation_does_not_echo_credentials(tmp_path):
    c, token = app(tmp_path)
    c.headers["Authorization"] = "Bearer " + token
    r = c.post(
        "/api/connections",
        json={
            "name": "CD2",
            "kind": "cd2",
            "config": {"url": "http://localhost:19798", "token": {"password": "credential-never-echo"}},
        },
    )
    assert r.status_code == 422
    assert "credential-never-echo" not in r.text


def test_uncertain_task_requires_explicit_confirmation_to_retry(tmp_path):
    c, token = app(tmp_path)
    c.headers["Authorization"] = "Bearer " + token
    s = c.app.state.store
    task = s.enqueue("Uncertain", "magnet:?xt=urn:btih:" + "ef" * 20, "test", "/Movies")
    s.update_task(task["id"], status="needs_review")
    route = "/api/tasks/" + task["id"] + "/retry"
    assert c.post(route, json={}).status_code == 400
    assert s.task(task["id"])["status"] == "needs_review"
    assert c.post(route, json={"confirm_not_submitted": True}).json()["status"] == "queued"
