"""The command line is a client of the exact same API as the Web UI."""

import argparse
import base64
import getpass
import json
import os
import sys
from pathlib import Path

import httpx


def parser():
    p = argparse.ArgumentParser(prog="cinebridge", description="幕间 · 找片、下载、片库")
    p.add_argument("--url", default=os.environ.get("CINEBRIDGE_URL", "http://127.0.0.1:8766"))
    p.add_argument(
        "--data", default=os.environ.get("CINEBRIDGE_DATA", str(Path.home() / ".local/share/cinebridge"))
    )
    sub = p.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="启动 Web、API 与后台任务")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8766)
    sub.add_parser("token", help="显示本机访问密钥（只在私有终端使用）")
    for name in ("status", "tasks", "library", "watchlist"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--json", action="store_true")
    search = sub.add_parser("search", help="搜索用户自己的资源源")
    search.add_argument("query")
    search.add_argument("--json", action="store_true")
    imp = sub.add_parser("import", help="导入磁力或种子，不自动下载")
    imp.add_argument("--title", required=True)
    group = imp.add_mutually_exclusive_group(required=True)
    group.add_argument("--magnet")
    group.add_argument("--torrent", type=Path)
    imp.add_argument("--year", type=int)
    imp.add_argument("--json", action="store_true")
    download = sub.add_parser("download")
    download.add_argument("resource_id")
    download.add_argument("--to", default="", help="多个 CD2 连接时选择保存位置")
    download.add_argument("--json", action="store_true")
    export = sub.add_parser("export", help="把搜索结果导出为逐行磁力链接")
    export.add_argument("query")
    for action in ("cancel", "retry"):
        cmd = sub.add_parser(action)
        cmd.add_argument("task_id")
        cmd.add_argument("--json", action="store_true")
        if action == "retry":
            cmd.add_argument(
                "--confirm-not-submitted",
                action="store_true",
                help="已手动确认 CD2 没有此任务，允许重试不确定的提交",
            )
    conn = sub.add_parser("connections")
    conn.add_argument("--json", action="store_true")
    conn_sub = conn.add_subparsers(dest="action")
    add = conn_sub.add_parser("add")
    add.add_argument("--kind", choices=["cd2", "alist", "json", "gateway"], required=True)
    add.add_argument("--name", required=True)
    add.add_argument("--endpoint", required=True)
    add.add_argument("--root", default="/")
    add.add_argument("--token-file", type=Path, help="从文件读取第三方令牌，避免进入 shell 历史")
    add.add_argument("--no-token", action="store_true")
    add.add_argument("--json", action="store_true")
    bundle = conn_sub.add_parser("import", help="导入独立用户的检索授权文件")
    bundle.add_argument("file", type=Path)
    bundle.add_argument("--json", action="store_true")
    test = conn_sub.add_parser("test")
    test.add_argument("id")
    test.add_argument("--json", action="store_true")
    subscribe = sub.add_parser("subscriptions")
    subscribe.add_argument("--json", action="store_true")
    subs = subscribe.add_subparsers(dest="action")
    add = subs.add_parser("add")
    add.add_argument("--name", required=True)
    add.add_argument("--user", required=True)
    add.add_argument("--statuses", nargs="+", choices=["wish", "do", "collect"], default=["wish"])
    add.add_argument("--auto-download", action="store_true")
    add.add_argument("--import-history", action="store_true")
    add.add_argument("--to", default="")
    add.add_argument("--json", action="store_true")
    sync = subs.add_parser("sync")
    sync.add_argument("id")
    sync.add_argument("--json", action="store_true")
    return p


def main():
    args = parser().parse_args()
    directory = Path(args.data)
    if args.command in ("serve", "token"):
        from .core import Store

        store = Store(directory)
        if args.command == "token":
            print(store.token)
            return
        import uvicorn

        from .app import create_app

        print(f"CineBridge → http://{args.host}:{args.port}", flush=True)
        print("本地模式：打开即可使用", flush=True)
        uvicorn.run(
            create_app(directory), host=args.host, port=args.port, access_log=False, log_level="warning"
        )
        return
    try:
        token = os.environ.get("CINEBRIDGE_TOKEN")
        if not token:
            token_path = Path(os.environ.get("CINEBRIDGE_TOKEN_FILE", str(directory / "admin.token")))
            token = token_path.read_text().strip() if token_path.exists() else ""
        with httpx.Client(
            base_url=args.url,
            headers={"Authorization": "Bearer " + token} if token else {},
            timeout=300,
            follow_redirects=False,
            trust_env=False,
        ) as http:

            def request(path, body=None):
                r = http.get("/api" + path) if body is None else http.post("/api" + path, json=body)
                if not r.is_success:
                    try:
                        detail = r.json().get("detail", "请求失败")
                    except ValueError:
                        detail = "服务请求失败"
                    raise ValueError(detail if isinstance(detail, str) else "参数验证失败")
                return r.json()

            cmd = args.command
            if cmd in ("status", "tasks", "library", "watchlist"):
                result = request("/overview" if cmd == "status" else "/" + cmd)
            elif cmd in ("search", "export"):
                from urllib.parse import quote

                result = request("/search?q=" + quote(args.query))
                if cmd == "export":
                    if result["errors"]:
                        raise ValueError("部分资源源失败，未导出不完整结果")
                    if len(result["items"]) > 100:
                        raise ValueError("单次最多导出 100 条，请缩小搜索范围")
                    lines = [
                        request("/resources/" + r["id"] + "/resolve", {})["magnet"] for r in result["items"]
                    ]
                    print("\n".join(lines))
                    return
            elif cmd == "import":
                body = {"title": args.title, "magnet": args.magnet or "", "year": args.year}
                if args.torrent:
                    if args.torrent.stat().st_size > 8 * 1024 * 1024:
                        raise ValueError("种子文件超过 8 MiB")
                    body["torrent"] = base64.b64encode(args.torrent.read_bytes()).decode()
                result = request("/import", body)
            elif cmd == "download":
                result = request("/tasks", {"resource_id": args.resource_id, "downloader_id": args.to})
            elif cmd in ("cancel", "retry"):
                result = request(
                    "/tasks/" + args.task_id + "/" + cmd,
                    {"confirm_not_submitted": getattr(args, "confirm_not_submitted", False)},
                )
            elif cmd == "connections":
                if args.action == "import":
                    if args.file.stat().st_size > 16384:
                        raise ValueError("授权文件过大")
                    try:
                        bundle = json.loads(args.file.read_text())
                        if (
                            not isinstance(bundle, dict)
                            or not isinstance(bundle.get("url"), str)
                            or not isinstance(bundle.get("token"), str)
                            or not bundle["token"]
                        ):
                            raise ValueError()
                    except ValueError:
                        raise ValueError("授权文件格式不正确") from None
                    result = request(
                        "/connections",
                        {
                            "name": "云端检索",
                            "kind": "gateway",
                            "config": {"url": bundle["url"], "token": bundle["token"]},
                        },
                    )
                elif args.action == "add":
                    secret = (
                        args.token_file.read_text().strip()
                        if args.token_file
                        else ""
                        if args.no_token
                        else getpass.getpass("服务访问令牌：")
                    )
                    result = request(
                        "/connections",
                        {
                            "name": args.name,
                            "kind": args.kind,
                            "config": {
                                "url": args.endpoint,
                                "token": secret,
                                **({} if args.kind == "gateway" else {"root": args.root}),
                            },
                        },
                    )
                elif args.action == "test":
                    result = request("/connections/" + args.id + "/test", {})
                else:
                    result = request("/connections")
            elif cmd == "subscriptions":
                if args.action == "add":
                    result = request(
                        "/subscriptions",
                        {
                            "name": args.name,
                            "user_id": args.user,
                            "statuses": args.statuses,
                            "auto_download": args.auto_download,
                            "import_history": args.import_history,
                            "downloader_id": args.to,
                        },
                    )
                elif args.action == "sync":
                    result = request("/subscriptions/" + args.id + "/sync", {})
                else:
                    result = request("/subscriptions")
            if getattr(args, "json", False):
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                items = result.get("items") if isinstance(result, dict) else result
                if isinstance(items, list):
                    for row in items:
                        print(
                            "  ".join(str(row.get(k, "")) for k in ("id", "title", "name", "status", "year"))
                        )
                    print(f"共 {len(items)} 条")
                    if isinstance(result, dict) and result.get("errors"):
                        print("部分资源源搜索失败，请检查连接", file=sys.stderr)
                else:
                    print(json.dumps(result, ensure_ascii=False, indent=2))
    except (ValueError, OSError, httpx.HTTPError):
        print("操作失败：请检查参数与本地服务连接。可用 --help 查看命令。", file=sys.stderr)
        raise SystemExit(1) from None
