import importlib.util

import httpx
import pytest


def connectors():
    assert importlib.util.find_spec("cinebridge.connectors"), "public protocol connectors missing"
    from cinebridge.connectors import AlistSource, DoubanSource, JsonSource, choose_candidate

    return AlistSource, DoubanSource, JsonSource, choose_candidate


def test_alist_search_paginates_and_only_returns_torrents():
    Alist, _, _, _ = connectors()
    pages = []

    def handle(r):
        import json

        body = json.loads(r.content)
        pages.append(body["page"])
        assert r.headers["Authorization"] == "secret"
        return httpx.Response(
            200,
            json={
                "code": 200,
                "data": {
                    "total": 2,
                    "content": [
                        {
                            "name": "Test.torrent" if body["page"] == 1 else "ad.exe",
                            "parent": "/Films",
                            "size": 40,
                        }
                    ],
                },
            },
        )

    src = Alist(
        {"url": "https://example.org", "token": "secret", "root": "/Films"},
        httpx.Client(transport=httpx.MockTransport(handle)),
    )
    result = src.search("Test")
    assert len(result) == 1 and result[0]["title"] == "Test"
    assert pages == [1, 2]


def test_douban_follows_next_and_blocks_partial_baseline():
    _, Douban, _, _ = connectors()

    def handle(r):
        if "start=15" in str(r.url):
            return httpx.Response(
                200,
                text='<html><title>我的电影</title><div class="item"><li class="title"><a href="https://movie.douban.com/subject/2/"><em>Moon / 月球</em></a></li><li class="intro">2009-01-01</li></div></html>',
            )
        return httpx.Response(
            200,
            text='<html><title>我的电影</title><div class="item"><li class="title"><a href="https://movie.douban.com/subject/1/"><em>Test</em></a></li></div><span class="next"><a href="?start=15">后页</a></span></html>',
        )

    src = Douban(httpx.Client(transport=httpx.MockTransport(handle)), sleep=lambda _: None)
    result = src.fetch("example", ["wish"])
    assert [x["subject_id"] for x in result] == ["1", "2"]
    assert result[1]["year"] == 2009
    with pytest.raises(ValueError, match="不完整"):
        src.fetch("example", ["wish"], max_pages=1)


def test_douban_captcha_is_not_empty_success():
    _, Douban, _, _ = connectors()
    src = Douban(
        httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, text="安全验证 captcha")))
    )
    with pytest.raises(ValueError):
        src.fetch("example", ["wish"])


def test_json_source_validates_magnets_and_auto_match_is_conservative():
    _, _, Json, choose = connectors()
    data = {
        "items": [
            {"title": "Moon", "year": 2009, "resolution": 1080, "magnet": "magnet:?xt=urn:btih:" + "ab" * 20}
        ]
    }
    src = Json(
        {"url": "https://example.org/catalog.json"},
        httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=data))),
    )
    candidates = src.search("Moon")
    assert len(candidates) == 1
    assert choose("Moon", 2009, candidates)["year"] == 2009
    assert choose("Moon", 2020, candidates) is None
    assert choose("Moo", 2009, candidates) is None


def test_douban_declared_total_must_match_before_accepting_snapshot():
    _, Douban, _, _ = connectors()
    text = '<h1>测试想看的电影(45)</h1><div class="item"><li class="title"><a href="https://movie.douban.com/subject/1/">Test</a></li></div>'
    source = Douban(httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, text=text))))
    with pytest.raises(ValueError, match="不完整"):
        source.fetch("example", ["wish"])


def test_alist_resolve_maps_configured_prefix_and_keeps_token_on_source_only():
    import json

    from cinebridge.connectors import AlistSource

    requests = []

    def handle(r):
        requests.append(r)
        if r.url.path == "/api/fs/get":
            assert json.loads(r.content)["path"] == "/Films/Example.torrent"
            return httpx.Response(
                200, json={"code": 200, "data": {"raw_url": "https://files.example/Example.torrent"}}
            )
        assert "authorization" not in r.headers
        return httpx.Response(
            200, content=b"d4:infod6:lengthi1e4:name1:x12:piece lengthi1e6:pieces20:aaaaaaaaaaaaaaaaaaaaee"
        )

    src = AlistSource(
        {"url": "https://catalog.example", "token": "private", "strip_prefix": "/Alias"},
        httpx.Client(transport=httpx.MockTransport(handle)),
    )
    assert src.resolve({"path": "/Alias/Films/Example.torrent"}).startswith("magnet:?xt=urn:btih:")
    assert len(requests) == 2


@pytest.mark.parametrize("password", ["secret", ""])
def test_alist_refreshes_expired_session_with_local_credentials(password):
    from cinebridge.connectors import AlistSource

    calls = []

    def handle(r):
        calls.append(r.url.path)
        if r.url.path == "/api/auth/login":
            return httpx.Response(200, json={"code": 200, "data": {"token": "renewed"}})
        if r.headers.get("Authorization") != "renewed":
            return httpx.Response(200, json={"code": 401, "message": "expired"})
        return httpx.Response(200, json={"code": 200, "data": {"content": [], "total": 0}})

    source = AlistSource(
        {"url": "https://refresh.example", "token": "expired", "username": "me", "password": password},
        httpx.Client(transport=httpx.MockTransport(handle)),
    )
    assert source.search("Example") == []
    assert calls == ["/api/fs/search", "/api/auth/login", "/api/fs/search"]


def test_douban_visible_snapshot_reports_count_gap_with_complete_pagination():
    _, Douban, _, _ = connectors()

    def handle(r):
        return httpx.Response(
            200,
            text="""<h1>测试想看的电影(2)</h1>
        <div class="grid-view"><div class="item"><li class="title">
        <a href="https://movie.douban.com/subject/1/">Test</a></li>
        <span class="date">2026-10-14</span></div></div>
        <div class="paginator"><span class="thispage" data-total-page="1">1</span><span class="next">后页</span></div>""",
        )

    source = Douban(httpx.Client(transport=httpx.MockTransport(handle)))
    items = source.fetch("example", ["wish"])
    assert items[0]["marked_date"] == "2026-10-14"
    assert source.snapshot == {"visible": 1, "declared": 2, "visibility_gap": True}


def test_douban_missing_next_before_last_page_is_rejected():
    _, Douban, _, _ = connectors()
    text = """<h1>测试想看的电影(2)</h1><div class="grid-view"><div class="item">
    <li class="title"><a href="https://movie.douban.com/subject/1/">Test</a></li></div></div>
    <div class="paginator"><span class="thispage" data-total-page="2">1</span></div>"""
    source = Douban(httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, text=text))))
    with pytest.raises(ValueError, match="不完整"):
        source.fetch("example", ["wish"])
