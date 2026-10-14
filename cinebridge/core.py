import base64
import contextlib
import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from cryptography.fernet import Fernet


def magnet_hash(value):
    if len(value) > 16384 or not value.startswith("magnet:?"):
        raise ValueError("需要有效的 BitTorrent v1 磁力链接")
    for xt in parse_qs(urlsplit(value).query).get("xt", []):
        if xt.lower().startswith("urn:btih:"):
            h = xt[9:]
            if re.fullmatch(r"[a-fA-F0-9]{40}", h):
                return h.lower()
            if re.fullmatch(r"[a-zA-Z2-7]{32}", h):
                return base64.b32decode(h.upper()).hex()
    raise ValueError("磁力链接缺少有效的 BTIH；暂不支持纯 v2 种子")


def torrent_magnet(data):
    if len(data) > 8 * 1024 * 1024:
        raise ValueError("种子文件超过 8 MiB")
    info_span = None

    def parse(pos, depth=0):
        nonlocal info_span
        if depth > 64 or pos >= len(data):
            raise ValueError("无效种子")
        start = pos
        kind = data[pos : pos + 1]
        if kind == b"i":
            end = data.find(b"e", pos)
            raw = data[pos + 1 : end]
            if end < 0 or not re.fullmatch(rb"0|-?[1-9][0-9]*", raw):
                raise ValueError("无效整数")
            return int(raw), end + 1
        if kind in (b"d", b"l"):
            value = {} if kind == b"d" else []
            pos += 1
            while pos < len(data) and data[pos : pos + 1] != b"e":
                key, pos = parse(pos, depth + 1)
                if kind == b"d":
                    if not isinstance(key, bytes) or key in value:
                        raise ValueError("无效或重复的字典键")
                    item_start = pos
                    item, pos = parse(pos, depth + 1)
                    value[key] = item
                    if depth == 0 and key == b"info":
                        info_span = (item_start, pos)
                else:
                    value.append(key)
            if pos >= len(data):
                raise ValueError("种子数据不完整")
            return value, pos + 1
        colon = data.find(b":", pos, pos + 20)
        if colon < 0 or not re.fullmatch(rb"0|[1-9][0-9]*", data[start:colon]):
            raise ValueError("无效字符串长度")
        end = colon + 1 + int(data[start:colon])
        if end > len(data):
            raise ValueError("种子数据不完整")
        return data[colon + 1 : end], end

    value, end = parse(0)
    if end != len(data) or not isinstance(value, dict) or not isinstance(value.get(b"info"), dict):
        raise ValueError("缺少 info 字典或有尾随数据")
    if b"pieces" not in value[b"info"]:
        raise ValueError("暂不支持纯 v2 种子")
    return "magnet:?xt=urn:btih:" + hashlib.sha1(data[slice(*info_span)]).hexdigest()


def private_file(path, value):
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        return Path(path).read_text().strip()
    with os.fdopen(fd, "w") as f:
        f.write(value)
    return value


def safe_folder(title):
    return re.sub(r'[\x00-\x1f/\\:*?"<>|]', "_", title).strip(" .")[:100] or "Untitled"


class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.cipher = Fernet(
            private_file(self.directory / "master.key", Fernet.generate_key().decode()).encode()
        )
        self.token = private_file(self.directory / "admin.token", secrets.token_urlsafe(32))
        self.path = self.directory / "cinebridge.db"
        with self.db() as db:
            db.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY, name TEXT NOT NULL,
              kind TEXT NOT NULL, config TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, title TEXT NOT NULL, magnet TEXT NOT NULL,
              info_hash TEXT NOT NULL, downloader_id TEXT NOT NULL, folder TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'queued', progress REAL NOT NULL DEFAULT 0,
              message TEXT NOT NULL DEFAULT '', files TEXT NOT NULL DEFAULT '[]',
              created REAL NOT NULL, updated REAL NOT NULL, UNIQUE(info_hash,downloader_id));
            CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY, source_id TEXT NOT NULL,
              title TEXT NOT NULL, data TEXT NOT NULL, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS watchlist(id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL,
              subject_id TEXT NOT NULL, title TEXT NOT NULL, year INTEGER, status TEXT NOT NULL,
              task_id TEXT, last_search REAL NOT NULL DEFAULT 0, UNIQUE(subscription_id,subject_id));
            CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,
              created REAL NOT NULL, message TEXT NOT NULL);
            """)
        os.chmod(self.path, 0o600)

    @contextlib.contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def event(self, message):
        with self.db() as db:
            db.execute("INSERT INTO events(created,message) VALUES (?,?)", (time.time(), message))
            db.execute("DELETE FROM events WHERE id < (SELECT MAX(id)-1000 FROM events)")

    def events(self):
        with self.db() as db:
            return [dict(x) for x in db.execute("SELECT * FROM events ORDER BY id DESC LIMIT 30")]

    def save_connection(self, obj):
        cid = obj.get("id") or uuid.uuid4().hex
        kind = obj["kind"]
        if kind not in ("alist", "json", "cd2", "gateway"):
            raise ValueError("未知连接类型")
        config = dict(obj.get("config", {}))
        if obj.get("id"):
            old = self.connection(cid, private=True)
            if old and old["kind"] == kind:
                for field in ("token",) if kind == "gateway" else ("token", "username", "password"):
                    if not config.get(field):
                        config[field] = old["config"].get(field, "")
        url = urlsplit(config.get("url", ""))
        if (
            url.scheme not in ("http", "https")
            or not url.hostname
            or url.username
            or url.password
            or url.fragment
        ):
            raise ValueError("连接地址须为 HTTP(S)，凭据请填写在令牌字段")
        if kind == "gateway" and (url.scheme != "https" or url.query or set(config) - {"url", "token"}):
            raise ValueError("云端网关须使用 HTTPS，仅填写网关地址和访问令牌")
        if kind in ("alist", "cd2") and url.query:
            raise ValueError("服务地址不能包含查询参数")
        encrypted = self.cipher.encrypt(json.dumps(config).encode()).decode()
        with self.db() as db:
            db.execute(
                "INSERT INTO connections VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                "name=excluded.name,kind=excluded.kind,config=excluded.config,enabled=excluded.enabled",
                (cid, obj["name"][:100], kind, encrypted, int(obj.get("enabled", True))),
            )
        return self.connection(cid)

    def connection(self, cid, private=False):
        with self.db() as db:
            row = db.execute("SELECT * FROM connections WHERE id=?", (cid,)).fetchone()
        if not row:
            return None
        out = dict(row)
        out["config"] = json.loads(self.cipher.decrypt(out["config"].encode()))
        if not private:
            out["has_token"] = bool(out["config"].pop("token", None))
            out["has_login"] = bool(out["config"].pop("username", None))
            out["config"].pop("password", None)
        return out

    def connections(self, private=False):
        with self.db() as db:
            ids = [r[0] for r in db.execute("SELECT id FROM connections ORDER BY rowid")]
        return [self.connection(cid, private) for cid in ids]

    def delete_connection(self, cid):
        with self.db() as db:
            if db.execute(
                "SELECT 1 FROM tasks WHERE downloader_id=? AND status NOT IN ('completed','cancelled')",
                (cid,),
            ).fetchone():
                raise ValueError("连接仍有关联任务，请先处理任务")
            for sub in self.subscriptions():
                if sub.get("downloader_id") == cid:
                    raise ValueError("连接仍被订阅使用")
            db.execute("DELETE FROM connections WHERE id=?", (cid,))

    def enqueue(self, title, magnet, downloader_id, root):
        h = magnet_hash(magnet)
        if not root.startswith("/") or ".." in root.split("/") or "\\" in root:
            raise ValueError("目标目录须为绝对云盘路径")
        folder = root.rstrip("/") + "/" + safe_folder(title) + " [" + h[:8] + "]"
        now = time.time()
        with self.db() as db:
            db.execute(
                "INSERT OR IGNORE INTO tasks(id,title,magnet,info_hash,downloader_id,folder,created,updated) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (uuid.uuid4().hex, title[:200], magnet, h, downloader_id, folder, now, now),
            )
            tid = db.execute(
                "SELECT id FROM tasks WHERE info_hash=? AND downloader_id=?", (h, downloader_id)
            ).fetchone()[0]
        return self.task(tid)

    def task(self, tid):
        with self.db() as db:
            row = db.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
        if not row:
            return None
        out = dict(row)
        out["files"] = json.loads(out["files"])
        return out

    def tasks(self):
        with self.db() as db:
            ids = [r[0] for r in db.execute("SELECT id FROM tasks ORDER BY created DESC")]
        return [self.task(tid) for tid in ids]

    def update_task(self, tid, **fields):
        allowed = {"status", "progress", "message", "files"}
        if not fields or not fields.keys() <= allowed:
            raise ValueError("非法任务更新")
        if "files" in fields:
            fields["files"] = json.dumps(fields["files"])
        fields["updated"] = time.time()
        with self.db() as db:
            db.execute(
                "UPDATE tasks SET " + ",".join(k + "=?" for k in fields) + " WHERE id=?",
                (*fields.values(), tid),
            )

    def claim(self):
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT id FROM tasks WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
            if not row:
                return None
            db.execute("UPDATE tasks SET status='submitting',updated=? WHERE id=?", (time.time(), row[0]))
        return self.task(row[0])

    def recover(self):
        with self.db() as db:
            db.execute(
                "UPDATE tasks SET status='needs_review',message='服务重启，正在核对远端提交结果' WHERE status='submitting'"
            )

    def cache_resource(self, item, source_id):
        value = dict(item, source_id=source_id)
        rid = hashlib.sha256((source_id + "\n" + json.dumps(item, sort_keys=True)).encode()).hexdigest()[:24]
        value["id"] = rid
        with self.db() as db:
            db.execute(
                "INSERT OR REPLACE INTO resources VALUES (?,?,?,?,?)",
                (rid, source_id, item["title"], json.dumps(value), time.time()),
            )
        return value

    def resource(self, rid):
        with self.db() as db:
            row = db.execute("SELECT data FROM resources WHERE id=?", (rid,)).fetchone()
        return json.loads(row[0]) if row else None

    def imported_resources(self, query):
        with self.db() as db:
            rows = db.execute(
                "SELECT data FROM resources WHERE source_id='import' ORDER BY created DESC"
            ).fetchall()
        return [json.loads(r[0]) for r in rows if query.casefold() in json.loads(r[0])["title"].casefold()]

    def save_subscription(self, obj):
        sid = obj.get("id") or uuid.uuid4().hex
        old = self.subscription(sid) or {}
        merged = {**old, **obj, "id": sid}
        merged.setdefault("initialized", False)
        merged.setdefault("enabled", True)
        merged.setdefault("last_poll", 0)
        merged.setdefault("message", "")
        with self.db() as db:
            db.execute("INSERT OR REPLACE INTO subscriptions VALUES (?,?)", (sid, json.dumps(merged)))
        return merged

    def subscription(self, sid):
        with self.db() as db:
            row = db.execute("SELECT data FROM subscriptions WHERE id=?", (sid,)).fetchone()
        return json.loads(row[0]) if row else None

    def subscriptions(self):
        with self.db() as db:
            return [json.loads(r[0]) for r in db.execute("SELECT data FROM subscriptions ORDER BY rowid")]

    def watchlist(self):
        with self.db() as db:
            return [dict(r) for r in db.execute("SELECT * FROM watchlist ORDER BY rowid DESC")]
