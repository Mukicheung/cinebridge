import base64
import fcntl
import os
import posixpath
import threading
from collections import Counter
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from .cd2 import CD2
from .connectors import parse_release
from .core import Store, magnet_hash, torrent_magnet
from .engine import Engine


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Connection(Model):
    id: str | None = None
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["alist", "json", "cd2"]
    config: dict[str, str]
    enabled: bool = True


class Import(Model):
    title: str = Field(min_length=1, max_length=200)
    magnet: str = Field(default="", max_length=16384)
    torrent: str = Field(default="", max_length=12 * 1024 * 1024)
    year: int | None = Field(default=None, ge=1880, le=2200)


class Task(Model):
    resource_id: str
    downloader_id: str = ""


class RetryOptions(Model):
    confirm_not_submitted: bool = False


class Subscription(Model):
    id: str | None = None
    name: str = Field(min_length=1, max_length=100)
    user_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    statuses: list[Literal["wish", "do", "collect"]] = Field(default=["wish"], min_length=1, max_length=3)
    auto_download: bool = False
    import_history: bool = False
    downloader_id: str = ""
    enabled: bool = True


def create_app(directory=None, worker=True):
    store = Store(directory or os.environ.get("CINEBRIDGE_DATA", Path.home() / ".local/share/cinebridge"))
    engine = Engine(store)

    @asynccontextmanager
    async def lifespan(app):
        thread = None
        lockfile = None
        if worker:
            lockfile = open(store.directory / "worker.lock", "w")
            try:
                fcntl.flock(lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                lockfile.close()
                raise RuntimeError("该数据目录已有 CineBridge 实例运行；请使用单进程部署") from None
            thread = threading.Thread(target=engine.run, daemon=True, name="cinebridge-worker")
            thread.start()
        yield
        engine.stop_event.set()
        if thread:
            thread.join(timeout=3)
        if lockfile:
            lockfile.close()

    app = FastAPI(title="CineBridge", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store, app.state.engine = store, engine
    static = Path(__file__).parent / "static"

    @app.middleware("http")
    async def protect(request: Request, call_next):
        if request.url.path.startswith("/api/"):
            origin = request.headers.get("origin")
            if origin and (
                urlsplit(origin).netloc != request.headers.get("host")
                or urlsplit(origin).scheme not in ("http", "https")
            ):
                return JSONResponse({"detail": "不允许跨站请求"}, status_code=403)
            if request.method in ("POST", "PUT", "PATCH"):
                size = 0
                chunks = []
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > 12 * 1024 * 1024:
                        return JSONResponse({"detail": "请求过大"}, status_code=413)
                    chunks.append(chunk)
                request._body = b"".join(chunks)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        )
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(ValueError)
    async def validation_error(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, exc):
        # Framework defaults echo invalid input, potentially including supplied credentials.
        return JSONResponse({"detail": "参数格式不正确，请检查必填字段和输入类型"}, status_code=422)

    @app.get("/healthz")
    def health():
        return {"status": "ok", "version": "0.1.0"}

    @app.get("/api/overview")
    def overview():
        return {
            "counts": dict(Counter(t["status"] for t in store.tasks())),
            "connections": store.connections(),
            "subscriptions": len(store.subscriptions()),
            "events": store.events(),
            "worker": {"enabled": worker, "last_tick": engine.last_tick, "message": engine.worker_error},
        }

    @app.get("/api/connections")
    def connections():
        return store.connections()

    @app.post("/api/connections")
    def connection_save(body: Connection):
        if set(body.config) - {"url", "token", "root", "strip_prefix", "username", "password"}:
            raise ValueError("不支持的连接配置字段")
        if body.kind == "cd2" and not body.config.get("root", "").startswith("/"):
            raise ValueError("请填写 CD2 内的完整入库路径")
        return store.save_connection(body.model_dump(exclude_none=True))

    @app.delete("/api/connections/{cid}")
    def connection_delete(cid: str):
        store.delete_connection(cid)
        return {"ok": True}

    @app.post("/api/connections/{cid}/test")
    def connection_test(cid: str):
        c = store.connection(cid, private=True)
        if not c:
            raise ValueError("连接不存在")
        adapter = None
        try:
            if c["kind"] == "cd2":
                adapter = CD2(c["config"])
                entries = adapter.ls(c["config"].get("root", "/"))
                return {"ok": True, "message": f"目录可读，共 {len(entries)} 个条目；写入能力在下载时验证"}
            adapter = engine.source(c)
            adapter.search("__cinebridge_connection_test__")
            return {"ok": True, "message": "资源源可访问"}
        except Exception:
            raise ValueError("连接测试失败，请检查地址、令牌、权限和网络") from None
        finally:
            if adapter:
                if hasattr(adapter, "close"):
                    adapter.close()
                elif hasattr(adapter, "http"):
                    adapter.http.close()

    @app.get("/api/search")
    def search(q: str = ""):
        if not 1 <= len(q.strip()) <= 100:
            raise ValueError("请输入 1 至 100 字的关键词")
        return engine.search(q.strip())

    @app.post("/api/import")
    def import_resource(body: Import):
        if body.torrent:
            try:
                magnet = torrent_magnet(base64.b64decode(body.torrent, validate=True))
            except Exception:
                raise ValueError("种子文件无效或暂不支持") from None
        else:
            magnet = body.magnet
            magnet_hash(magnet)
        item = dict(parse_release(body.title), magnet=magnet, size=0, format="magnet")
        if body.year:
            item["year"] = body.year
        return store.cache_resource(item, "import")

    @app.post("/api/resources/{rid}/resolve")
    def resolve_resource(rid: str):
        try:
            return {"magnet": engine.resolve(rid)}
        except Exception:
            raise ValueError("资源解析失败，请检查资源源和种子格式") from None

    @app.get("/api/tasks")
    def tasks():
        return store.tasks()

    @app.post("/api/tasks")
    def task_create(body: Task):
        try:
            return engine.enqueue_resource(body.resource_id, body.downloader_id)
        except Exception:
            raise ValueError("无法创建任务，请检查资源和下载连接") from None

    @app.post("/api/tasks/{tid}/{action}")
    def task_action(tid: str, action: Literal["cancel", "retry"], body: RetryOptions | None = None):
        with engine.lock:
            task = store.task(tid)
            if not task:
                raise ValueError("任务不存在")
            if action == "retry" and task["status"] in ("failed", "cancelled"):
                store.update_task(tid, status="queued", message="已安排重新提交")
            elif (
                action == "retry" and task["status"] == "needs_review" and body and body.confirm_not_submitted
            ):
                store.update_task(tid, status="queued", message="用户已核对远端无此任务，安排重新提交")
            elif action == "cancel" and task["status"] == "queued":
                store.update_task(tid, status="cancelled", message="已取消本地待提交任务")
            else:
                raise ValueError("当前状态不允许此操作；已提交任务请在 CD2 中处理")
            return store.task(tid)

    @app.get("/api/library")
    def library():
        return [t for t in store.tasks() if t["status"] == "completed"]

    @app.get("/api/library/browse")
    def browse_library(connection_id: str, path: str = ""):
        c = store.connection(connection_id, private=True)
        if not c or c["kind"] != "cd2" or not c["enabled"]:
            raise ValueError("请先连接 115 下载服务")
        root = posixpath.normpath(c["config"].get("root", "/"))
        requested = posixpath.normpath(path or root)
        if requested != root and not requested.startswith(root.rstrip("/") + "/"):
            raise ValueError("只能浏览已配置的片库目录")
        adapter = CD2(c["config"])
        try:
            items = adapter.ls(requested)
            items = sorted(items, key=lambda f: (not f["is_dir"], f["name"].casefold()))
            return {
                "path": requested,
                "root": root,
                "parent": posixpath.dirname(requested) if requested != root else "",
                "items": items,
            }
        except Exception:
            raise ValueError("片库暂时无法读取，请检查 CD2 连接") from None
        finally:
            adapter.close()

    @app.get("/api/subscriptions")
    def subscriptions():
        return store.subscriptions()

    @app.post("/api/subscriptions")
    def subscription_save(body: Subscription):
        if body.auto_download:
            c = store.connection(body.downloader_id)
            if not c or c["kind"] != "cd2" or not c["enabled"]:
                raise ValueError("自动下载需要已启用的 CD2 连接")
        if body.id:
            old = store.subscription(body.id)
            if not old:
                raise ValueError("订阅不存在")
            if old["user_id"] != body.user_id or set(old["statuses"]) != set(body.statuses):
                raise ValueError("变更账号或片单范围请新建订阅，避免混用历史基线")
        return store.save_subscription(body.model_dump(exclude_none=True))

    @app.post("/api/subscriptions/{sid}/sync")
    def subscription_sync(sid: str):
        engine.sync(sid)
        return store.subscription(sid)

    @app.get("/api/watchlist")
    def watchlist():
        return store.watchlist()

    @app.get("/")
    def index():
        return FileResponse(static / "index.html")

    app.mount("/static", StaticFiles(directory=static), name="static")
    return app
