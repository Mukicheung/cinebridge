import sqlite3

import httpx
import pytest
from fastapi.testclient import TestClient

from cinebridge import connectors
from cinebridge.app import create_app
from cinebridge.connectors import DoubanSource, fetch_poster, safe_poster_url
from cinebridge.core import Store
from cinebridge.engine import Engine

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64

GRID = """<h1>测试想看的电影(3)</h1><div class="grid-view">
<div class="item"><div class="pic"><a href="https://movie.douban.com/subject/1/">
<img src="https://img9.doubanio.com/view/photo/s_ratio_poster/public/p123.jpg"></a></div>
<li class="title"><a href="https://movie.douban.com/subject/1/">One</a></li></div>
<div class="item"><img src="https://img1.doubanio.com/view/photo/s_ratio_poster/public/p9.webp">
<li class="title"><a href="https://movie.douban.com/subject/2/">Two</a></li></div>
<div class="item"><div class="pic"><img src="http://evil.example/x.jpg"></div>
<li class="title"><a href="https://movie.douban.com/subject/3/">Three</a></li></div>
</div>"""


def test_douban_parses_cover_and_rejects_untrusted_hosts():
    src = DoubanSource(httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, text=GRID))))
    items = {i["subject_id"]: i for i in src.fetch("me", ["wish"])}
    assert items["1"]["cover"] == "https://img9.doubanio.com/view/photo/m_ratio_poster/public/p123.jpg"
    assert items["2"]["cover"].startswith("https://img1.doubanio.com/")
    assert items["3"]["cover"] == ""


@pytest.mark.parametrize(
    "url",
    [
        "http://img9.doubanio.com/a.jpg",
        "https://img9.doubanio.com.evil.com/a.jpg",
        "https://evil.com/img9.doubanio.com/a.jpg",
        "https://user@img9.doubanio.com/a.jpg",
        "https://img9.doubanio.com:8443/a.jpg",
        "https://127.0.0.1/a.jpg",
        "",
        None,
    ],
)
def test_untrusted_poster_hosts_are_rejected(url):
    assert safe_poster_url(url) == ""
    with pytest.raises(ValueError):
        fetch_poster(
            url, http=httpx.Client(transport=httpx.MockTransport(lambda r: pytest.fail("contacted")))
        )


def test_legacy_watchlist_migrates_and_resync_backfills_cover(tmp_path):
    db = sqlite3.connect(tmp_path / "cinebridge.db")
    db.execute(
        "CREATE TABLE watchlist(id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, subject_id TEXT NOT NULL,"
        " title TEXT NOT NULL, year INTEGER, status TEXT NOT NULL, task_id TEXT,"
        " last_search REAL NOT NULL DEFAULT 0, UNIQUE(subscription_id,subject_id))"
    )
    db.execute(
        "INSERT INTO watchlist(id,subscription_id,subject_id,title,status) VALUES ('w','s','1','Old','baseline')"
    )
    db.commit()
    db.close()
    store = Store(tmp_path)
    assert store.watchlist()[0]["cover"] == ""
    Store(tmp_path)  # migration is idempotent
    sub = store.save_subscription(
        {"id": "s", "name": "x", "user_id": "me", "statuses": ["wish"], "initialized": True}
    )
    cover = "https://img9.doubanio.com/view/photo/m_ratio_poster/public/p1.jpg"
    Engine(store).ingest(sub["id"], [{"subject_id": "1", "title": "Old", "cover": cover}])
    rows = store.watchlist()
    assert len(rows) == 1 and rows[0]["status"] == "baseline" and rows[0]["cover"] == cover
    Engine(store).ingest(sub["id"], [{"subject_id": "1", "title": "Old", "cover": "https://evil.com/a.jpg"}])
    assert store.watchlist()[0]["cover"] == cover


def test_poster_endpoint_downloads_once_then_serves_cache(tmp_path, monkeypatch):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(200, content=JPEG, headers={"content-type": "image/jpeg"})

    monkeypatch.setattr(connectors, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle)))
    application = create_app(tmp_path, worker=False)
    store = application.state.store
    sub = store.save_subscription({"name": "x", "user_id": "me", "statuses": ["wish"]})
    cover = "https://img9.doubanio.com/view/photo/m_ratio_poster/public/p1.jpg"
    application.state.engine.ingest(
        sub["id"], [{"subject_id": "1", "title": "A", "cover": cover}, {"subject_id": "2", "title": "B"}]
    )
    c = TestClient(application)
    items = {i["subject_id"]: i for i in c.get("/api/watchlist").json()}
    assert items["1"]["poster"] == "/api/posters/1" and items["2"]["poster"] is None
    assert "cover" not in items["1"]
    for _ in range(2):
        r = c.get("/api/posters/1")
        assert r.status_code == 200 and r.content == JPEG
        assert r.headers["content-type"] == "image/jpeg"
        assert r.headers["cache-control"] == "public, max-age=604800"
    assert len(calls) == 1
    assert calls[0].headers["referer"] == "https://movie.douban.com/"
    assert calls[0].url.host == "img9.doubanio.com"
    assert (tmp_path / "posters" / "1.jpg").read_bytes() == JPEG
    assert c.get("/api/posters/2").status_code == 404
    assert c.get("/api/posters/abc").status_code == 404
    assert c.get("/api/watchlist").headers["cache-control"] == "no-store"


def test_poster_endpoint_upstream_failure_is_502_without_url(tmp_path, monkeypatch):
    monkeypatch.setattr(
        connectors,
        "client",
        lambda: httpx.Client(
            transport=httpx.MockTransport(
                lambda r: httpx.Response(200, text="<html>", headers={"content-type": "text/html"})
            )
        ),
    )
    application = create_app(tmp_path, worker=False)
    store = application.state.store
    sub = store.save_subscription({"name": "x", "user_id": "me", "statuses": ["wish"]})
    application.state.engine.ingest(
        sub["id"],
        [
            {
                "subject_id": "5",
                "title": "A",
                "cover": "https://img3.doubanio.com/view/photo/m_ratio_poster/public/p5.jpg",
            }
        ],
    )
    r = TestClient(application).get("/api/posters/5")
    assert r.status_code == 502 and "doubanio" not in r.text and r.headers["cache-control"] == "no-store"
    assert not (tmp_path / "posters" / "5.jpg").exists()


def test_poster_endpoint_never_contacts_untrusted_stored_host(tmp_path, monkeypatch):
    monkeypatch.setattr(
        connectors,
        "client",
        lambda: httpx.Client(transport=httpx.MockTransport(lambda r: pytest.fail("contacted"))),
    )
    application = create_app(tmp_path, worker=False)
    with application.state.store.db() as db:
        db.execute(
            "INSERT INTO watchlist(id,subscription_id,subject_id,title,status,cover) VALUES ('w','s','7','X','waiting','http://169.254.169.254/x')"
        )
    assert TestClient(application).get("/api/posters/7").status_code == 502
