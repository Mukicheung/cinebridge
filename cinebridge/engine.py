import threading
import time
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from .cd2 import CD2
from .connectors import (
    AlistSource,
    DoubanSource,
    GatewaySource,
    JsonSource,
    choose_candidate,
    safe_poster_url,
)
from .core import magnet_hash


class Engine:
    def __init__(self, store, downloader_factory=None):
        self.store = store
        self.downloader_factory = downloader_factory or (lambda c: CD2(c["config"]))
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.last_tick = 0
        self.worker_error = ""

    def source(self, connection):
        return {"alist": AlistSource, "json": JsonSource, "gateway": GatewaySource}[connection["kind"]](
            connection["config"]
        )

    def search(self, query):
        results, errors = self.store.imported_resources(query), []
        for c in self.store.connections(private=True):
            if c["kind"] == "cd2" or not c["enabled"]:
                continue
            source = self.source(c)
            try:
                results.extend(self.store.cache_resource(item, c["id"]) for item in source.search(query))
            except Exception:
                errors.append({"source": c["name"], "message": "搜索失败，请检查连接、令牌和资源索引"})
            finally:
                source.http.close()
        return {"items": results, "errors": errors}

    def resolve(self, rid):
        item = self.store.resource(rid)
        if not item:
            raise ValueError("资源不存在，请重新搜索")
        if item.get("magnet"):
            magnet_hash(item["magnet"])
            return item["magnet"]
        c = self.store.connection(item["source_id"], private=True)
        if not c or not c["enabled"]:
            raise ValueError("资源源已停用")
        source = self.source(c)
        try:
            return source.resolve(item)
        finally:
            source.http.close()

    def enqueue_resource(self, rid, downloader_id=""):
        if not downloader_id:
            choices = [c for c in self.store.connections() if c["kind"] == "cd2" and c["enabled"]]
            if len(choices) == 1:
                downloader_id = choices[0]["id"]
        item = self.store.resource(rid)
        c = self.store.connection(downloader_id, private=True)
        if not item or not c or c["kind"] != "cd2" or not c["enabled"]:
            raise ValueError("请选择有效资源和已启用的 CD2 连接")
        return self.store.enqueue(item["title"], self.resolve(rid), c["id"], c["config"].get("root", ""))

    def tick(self):
        with self.lock:
            self._tick()
            self.last_tick = time.time()

    def _tick(self):
        task = self.store.claim()
        if task:
            connection = self.store.connection(task["downloader_id"], private=True)
            remote = None
            try:
                if not connection or not connection["enabled"]:
                    raise ValueError("连接不可用")
                remote = self.downloader_factory(connection)
                remote.prepare(task["folder"])
            except Exception:
                self.store.update_task(
                    task["id"], status="failed", message="准备目录失败；请检查 CD2 连接和目录权限"
                )
            else:
                try:
                    remote.submit(task["magnet"], task["folder"])
                    self.store.update_task(task["id"], status="submitted", message="已提交，等待远端下载状态")
                except Exception:
                    self.store.update_task(
                        task["id"],
                        status="needs_review",
                        message="提交结果不确定，自动核对远端；不会自动重复提交",
                    )
            finally:
                if remote and hasattr(remote, "close"):
                    remote.close()
        for task in self.store.tasks():
            if task["status"] not in ("submitted", "downloading", "downloaded", "needs_review"):
                continue
            remote = None
            try:
                connection = self.store.connection(task["downloader_id"], private=True)
                if not connection or not connection["enabled"]:
                    continue
                remote = self.downloader_factory(connection)
                status = remote.status(task["info_hash"], task["folder"])
                if status["status"] == "finished" or task["status"] == "downloaded":
                    self.store.update_task(
                        task["id"], status="downloaded", progress=100, message="下载完成，正在验证媒体文件"
                    )
                    files = remote.media_files(task["folder"])
                    if files:
                        self.store.update_task(
                            task["id"],
                            status="completed",
                            files=files,
                            message="远端下载完成，媒体文件已验证",
                        )
                        self.store.event("任务完成，媒体文件已验证")
                elif status["status"] in ("pending", "downloading"):
                    self.store.update_task(
                        task["id"], status="downloading", progress=status["progress"], message="远端正在下载"
                    )
                elif status["status"] == "error":
                    self.store.update_task(
                        task["id"], status="failed", message="远端下载失败，请先处理 CD2 中的失败任务再重试"
                    )
            except Exception:
                self.store.update_task(task["id"], message="暂时无法核对远端状态，将在下一轮重试")
            finally:
                if remote and hasattr(remote, "close"):
                    remote.close()

    def ingest(self, sid, items, snapshot=None):
        sub = self.store.subscription(sid)
        baseline = not sub.get("initialized") and not sub.get("import_history", False)
        if not sub.get("initialized"):
            sub["baseline_date"] = datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat()
        if snapshot:
            sub["snapshot"] = snapshot
            sub["visibility_guard"] = sub.get("visibility_guard", False) or snapshot.get(
                "visibility_gap", False
            )
        with self.store.db() as db:
            for item in items:
                item_status = "baseline" if baseline else "waiting"
                if not baseline and sub.get("visibility_guard") and not sub.get("import_history"):
                    try:
                        marked = datetime.strptime(item.get("marked_date", ""), "%Y-%m-%d").date().isoformat()
                    except ValueError:
                        marked = ""
                    if not marked or marked == sub.get("baseline_date"):
                        item_status = "needs_review"
                    elif marked < sub.get("baseline_date", ""):
                        item_status = "baseline"
                cover = safe_poster_url(item.get("cover", ""))
                db.execute(
                    "INSERT OR IGNORE INTO watchlist(id,subscription_id,subject_id,title,year,status,cover) VALUES (?,?,?,?,?,?,?)",
                    (
                        uuid.uuid4().hex,
                        sid,
                        item["subject_id"],
                        item["title"],
                        item.get("year"),
                        item_status,
                        cover,
                    ),
                )
                if cover:
                    # Only refresh artwork on existing rows; status/baseline stay untouched.
                    db.execute(
                        "UPDATE watchlist SET cover=? WHERE subscription_id=? AND subject_id=? AND cover!=?",
                        (cover, sid, item["subject_id"], cover),
                    )
            sub.update(
                initialized=True,
                last_poll=time.time(),
                message=(
                    f"已同步公开可见 {len(items)} 条"
                    + (
                        f"，页面标注 {snapshot['declared']} 条"
                        if snapshot and snapshot.get("visibility_gap")
                        else ""
                    )
                    + ("；历史基线已保留" if baseline else "")
                ),
            )
            import json

            db.execute("UPDATE subscriptions SET data=? WHERE id=?", (json.dumps(sub), sid))

    def sync(self, sid):
        with self.lock:
            sub = self.store.subscription(sid)
            if not sub:
                raise ValueError("订阅不存在")
            if time.time() - sub.get("last_attempt", 0) < 600:
                raise ValueError("距离上次同步不足 10 分钟，请稍后再试")
            self.store.save_subscription(dict(sub, last_attempt=time.time()))
            source = DoubanSource()
            try:
                items = source.fetch(sub["user_id"], sub["statuses"])
                self.ingest(sid, items, snapshot=source.snapshot)
            except Exception as exc:
                # Only our own parser errors are safe for display; upstream exceptions can contain URLs/tokens.
                message = (
                    str(exc) if isinstance(exc, ValueError) else "豆瓣访问失败，请检查公开片单与网络连接"
                )
                self.store.save_subscription(dict(self.store.subscription(sid), message=message))
                raise ValueError(message) from None
            finally:
                source.http.close()

    def search_waiting(self):
        for item in self.store.watchlist():
            if item["status"] != "waiting" or time.time() - item["last_search"] < 6 * 3600:
                continue
            sub = self.store.subscription(item["subscription_id"])
            if not sub or not sub.get("enabled") or not sub.get("auto_download"):
                continue
            with self.store.db() as db:
                db.execute("UPDATE watchlist SET last_search=? WHERE id=?", (time.time(), item["id"]))
            candidate = choose_candidate(item["title"], item["year"], self.search(item["title"])["items"])
            if candidate:
                try:
                    task = self.enqueue_resource(candidate["id"], sub["downloader_id"])
                    with self.store.db() as db:
                        db.execute(
                            "UPDATE watchlist SET status='queued',task_id=? WHERE id=?",
                            (task["id"], item["id"]),
                        )
                except Exception:
                    self.store.event("订阅下载提交准备失败，保留片单等待下次重试")

    def run(self):
        self.store.recover()
        while not self.stop_event.is_set():
            try:
                self.tick()
                for sub in self.store.subscriptions():
                    if sub.get("enabled") and time.time() - sub.get("last_attempt", 0) >= 600:
                        try:
                            self.sync(sub["id"])
                        except ValueError:
                            pass
                self.search_waiting()
                self.worker_error = ""
            except Exception:
                self.worker_error = "后台任务出错，下一轮重试"
            self.stop_event.wait(30)
