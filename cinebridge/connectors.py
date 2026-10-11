"""Public protocol adapters. No bundled resource endpoints or user credentials."""

import json
import posixpath
import re
import time
import unicodedata
from urllib.parse import quote, urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup

from .core import magnet_hash, torrent_magnet


def client():
    return httpx.Client(
        timeout=25,
        follow_redirects=False,
        trust_env=False,
        headers={"User-Agent": "CineBridge/0.1 (self-hosted media organizer)"},
    )


def limited_get(http, url, headers=None, limit=8 * 1024 * 1024):
    with http.stream("GET", url, headers=headers or {}) as response:
        response.raise_for_status()
        if response.is_redirect:
            raise ValueError("资源地址发生重定向，请配置最终地址")
        result = bytearray()
        for block in response.iter_bytes():
            result.extend(block)
            if len(result) > limit:
                raise ValueError("响应超过大小限制")
        return bytes(result)


def parse_release(name):
    name = re.sub(r"\.torrent$", "", name, flags=re.I)
    match = re.search(r"(?<!\d)((?:19|20)\d{2})(?!\d)", name)
    year = int(match[1]) if match else None
    title = name[: match.start()] if match else re.split(r"(?i)\b(?:2160p|1080p|720p|s\d{2})\b", name)[0]
    resolution = re.search(r"(?i)(2160|1080|720)p", name)
    return {
        "title": title.replace(".", " ").strip(" ._-()[]"),
        "year": year,
        "resolution": int(resolution[1]) if resolution else 0,
        "name": name,
    }


class AlistSource:
    def __init__(self, config, http=None):
        self.config = config
        self.http = http or client()

    def api(self, path, body):
        r = self.http.post(
            self.config["url"].rstrip("/") + path,
            json=body,
            headers={"Authorization": self.config.get("token", "")},
        )
        r.raise_for_status()
        obj = r.json()
        if obj.get("code") != 200:
            raise ValueError("资源源请求失败，请检查令牌、权限和索引状态")
        return obj.get("data") or {}

    def search(self, query):
        result, fetched = [], 0
        for page in range(1, 51):
            data = self.api(
                "/api/fs/search",
                {
                    "parent": self.config.get("root", "/"),
                    "keywords": query,
                    "scope": 2,
                    "page": page,
                    "per_page": 100,
                    "password": "",
                },
            )
            items = data.get("content") or []
            for item in items:
                if item.get("is_dir") or not item.get("name", "").lower().endswith(".torrent"):
                    continue
                path = posixpath.join(item.get("parent", "/"), item["name"])
                result.append(
                    dict(
                        parse_release(item["name"]),
                        path=path,
                        size=0,
                        torrent_bytes=item.get("size", 0),
                        format="torrent",
                    )
                )
            fetched += len(items)
            if fetched >= data.get("total", fetched) or not items:
                return result
        raise ValueError("搜索结果超过 5000 条，请缩小关键词")

    def resolve(self, resource):
        data = self.api("/api/fs/get", {"path": resource["path"], "password": ""})
        url = data.get("raw_url", "")
        if urlsplit(url).scheme not in ("https", "http"):
            raise ValueError("资源源未返回可下载的种子")
        # Never forward the source API token to a download host.
        return torrent_magnet(limited_get(self.http, url))


class JsonSource:
    def __init__(self, config, http=None):
        self.config = config
        self.http = http or client()

    def search(self, query):
        headers = {"Authorization": "Bearer " + self.config["token"]} if self.config.get("token") else {}
        data = json.loads(limited_get(self.http, self.config["url"], headers))
        items = data.get("items", []) if isinstance(data, dict) else data
        if not isinstance(items, list) or len(items) > 10000:
            raise ValueError("资源目录格式错误或超过 10000 条")
        result = []
        for item in items:
            if query.casefold() not in str(item.get("title", "")).casefold():
                continue
            magnet_hash(item.get("magnet", ""))
            result.append(
                {
                    "title": str(item["title"])[:200],
                    "name": str(item.get("name", item["title"]))[:500],
                    "year": int(item["year"]) if item.get("year") else None,
                    "resolution": int(item.get("resolution", 0)),
                    "size": int(item.get("size", 0)),
                    "magnet": item["magnet"],
                    "format": "magnet",
                }
            )
        return result

    def resolve(self, resource):
        magnet_hash(resource["magnet"])
        return resource["magnet"]


def normalize(text):
    return re.sub(r"[^\w]", "", unicodedata.normalize("NFKC", text).casefold())


def choose_candidate(title, year, candidates):
    eligible = [
        r
        for r in candidates
        if normalize(r["title"]) == normalize(title) and (not year or r.get("year") == year)
    ]
    if not eligible:
        return None
    return max(
        eligible,
        key=lambda r: (
            not bool(re.search(r"(?i)\b(?:BDMV|ISO|DISC)\b", r.get("name", ""))),
            r.get("resolution", 0),
            r.get("size", 0),
        ),
    )


class DoubanSource:
    def __init__(self, http=None, sleep=time.sleep):
        self.http = http or client()
        self.sleep = sleep

    def fetch(self, user_id, statuses, max_pages=100):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", user_id):
            raise ValueError("豆瓣用户 ID 格式不正确")
        items = {}
        for status in statuses:
            if status not in ("wish", "do", "collect"):
                raise ValueError("未知豆瓣片单类型")
            url = f"https://movie.douban.com/people/{quote(user_id)}/{status}"
            visited = set()
            status_ids = set()
            declared_total = None
            for page in range(max_pages):
                if url in visited:
                    raise ValueError("豆瓣分页循环，结果不完整")
                visited.add(url)
                text = limited_get(self.http, url, limit=2 * 1024 * 1024).decode("utf-8", errors="replace")
                soup = BeautifulSoup(text, "html.parser")
                if page == 0:
                    heading = soup.find("h1") or soup.find("title")
                    total = re.search(
                        r"(?:想看|在看|看过).*?[（(](\d+)[)）]", heading.get_text() if heading else ""
                    )
                    declared_total = int(total[1]) if total else None
                if re.search(r"captcha|安全验证|异常请求|访问豆瓣的方式有点像机器人", text, re.I):
                    raise ValueError("豆瓣要求验证，已停止同步；请稍后在豆瓣处理")
                containers = soup.select(".item")
                count = 0
                for item in containers:
                    a = item.select_one('.title a[href*="/subject/"]')
                    if not a:
                        raise ValueError("豆瓣条目解析不完整，未更新基线")
                    match = re.search(r"/subject/(\d+)/", a.get("href", ""))
                    if not match:
                        raise ValueError("豆瓣条目 ID 无效")
                    titles = [v.strip() for v in a.get_text(" ", strip=True).split(" / ")]
                    intro = item.select_one(".intro")
                    year = re.search(r"(?<!\d)((?:19|20)\d{2})(?:-|\b)", intro.get_text() if intro else "")
                    items.setdefault(
                        match[1],
                        {
                            "subject_id": match[1],
                            "title": titles[0],
                            "year": int(year[1]) if year else None,
                            "douban_status": status,
                        },
                    )
                    status_ids.add(match[1])
                    count += 1
                if not count and not (soup.select_one(".grid-view") or "还没有" in text or "尚未" in text):
                    raise ValueError("无法读取豆瓣公开片单，未更新基线")
                next_link = soup.select_one('.next a[href], a[rel="next"][href]')
                if not next_link:
                    break
                next_url = urljoin(url, next_link["href"])
                u = urlsplit(next_url)
                if (
                    u.scheme != "https"
                    or u.netloc != "movie.douban.com"
                    or not u.path.startswith(f"/people/{user_id}/{status}")
                ):
                    raise ValueError("豆瓣分页地址异常")
                url = next_url
                if page + 1 == max_pages:
                    raise ValueError("豆瓣分页超过限制，结果不完整")
                self.sleep(1.5)
            if declared_total is not None and len(status_ids) != declared_total:
                raise ValueError("豆瓣页面总数与已解析条目不一致，结果不完整；未更新基线")
        return list(items.values())
