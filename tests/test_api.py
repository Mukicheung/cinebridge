import importlib.util

from fastapi.testclient import TestClient


def app(tmp_path):
    assert importlib.util.find_spec("cinebridge.app"), "authenticated API missing"
    from cinebridge.app import create_app

    application = create_app(tmp_path, worker=False)
    return TestClient(application), application.state.store.token


def test_local_api_opens_without_password_and_denies_cross_origin(tmp_path):
    c, token = app(tmp_path)
    assert c.get("/healthz").status_code == 200
    assert c.get("/api/overview").status_code == 200
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


def test_library_browses_existing_files_within_configured_root(tmp_path, monkeypatch):
    c, _ = app(tmp_path)
    root = "/115/Movies"
    conn = c.post(
        "/api/connections",
        json={"name": "My 115", "kind": "cd2", "config": {"url": "http://localhost:19798", "root": root}},
    ).json()
    calls = []

    class Drive:
        def __init__(self, config):
            pass

        def ls(self, path):
            calls.append(path)
            return [{"name": "Example.mkv", "path": path + "/Example.mkv", "size": 123, "is_dir": False}]

        def close(self):
            pass

    monkeypatch.setattr("cinebridge.app.CD2", Drive)
    url = "/api/library/browse"
    response = c.get(url, params={"connection_id": conn["id"]})
    assert response.status_code == 200
    assert response.json()["items"][0]["name"] == "Example.mkv"
    assert calls == [root]
    assert (
        c.get(url, params={"connection_id": conn["id"], "path": "/115/Movies/../Secrets"}).status_code == 400
    )
    assert c.get(url, params={"connection_id": conn["id"], "path": "/115/Movies-other"}).status_code == 400
    assert calls == [root]


def test_subscription_update_and_sync_preserve_baseline(tmp_path, monkeypatch):
    c, _ = app(tmp_path)
    s = c.post("/api/subscriptions", json={"name": "My watchlist", "user_id": "example"}).json()
    updated = c.post("/api/subscriptions", json={"id": s["id"], "name": "Renamed", "user_id": "example"})
    assert updated.status_code == 200
    monkeypatch.setattr(
        "cinebridge.engine.DoubanSource.fetch",
        lambda self, *args: [{"subject_id": "1", "title": "Example", "year": 2020}],
    )
    result = c.post("/api/subscriptions/" + s["id"] + "/sync")
    assert result.status_code == 200
    assert result.json()["initialized"] is True
    assert c.get("/api/watchlist").json()[0]["status"] == "baseline"
    assert c.get("/api/tasks").json() == []


def test_download_automatically_uses_only_enabled_115_connection(tmp_path):
    c, _ = app(tmp_path)
    conn = c.post(
        "/api/connections",
        json={
            "name": "My 115",
            "kind": "cd2",
            "config": {"url": "http://localhost:19798", "root": "/115/Movies"},
        },
    ).json()
    item = c.post(
        "/api/import", json={"title": "Example", "magnet": "magnet:?xt=urn:btih:" + "cd" * 20}
    ).json()
    r = c.post("/api/tasks", json={"resource_id": item["id"]})
    assert r.status_code == 200
    assert r.json()["downloader_id"] == conn["id"]


def test_saved_source_login_is_private_and_preserved_on_edit(tmp_path):
    c, _ = app(tmp_path)
    body = {
        "name": "Source",
        "kind": "alist",
        "config": {
            "url": "https://source.example",
            "token": "sensitive-token",
            "username": "private-user",
            "password": "private-password",
        },
    }
    row = c.post("/api/connections", json=body).json()
    payload = c.get("/api/connections").text
    assert (
        "private-user" not in payload
        and "private-password" not in payload
        and "sensitive-token" not in payload
    )
    update = {
        "id": row["id"],
        "name": "Renamed",
        "kind": "alist",
        "config": {"url": "https://source.example", "root": "/"},
    }
    assert c.post("/api/connections", json=update).status_code == 200
    saved = c.app.state.store.connection(row["id"], private=True)["config"]
    assert saved["password"] == "private-password"
