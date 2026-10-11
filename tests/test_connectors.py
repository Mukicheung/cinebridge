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
