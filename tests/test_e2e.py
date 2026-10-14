"""Isolated network acceptance: HTTP catalog -> API -> real gRPC -> verified library."""

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import grpc
from fastapi.testclient import TestClient

from cinebridge.app import create_app
from cinebridge.cd2 import MESSAGES as M


def test_catalog_to_library_survives_restart_without_duplicate(tmp_path):
    hash_ = "cd" * 20

    class Catalog(BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps(
                {
                    "items": [
                        {
                            "title": "Independent Test Film",
                            "year": 2026,
                            "magnet": "magnet:?xt=urn:btih:" + hash_,
                            "resolution": 1080,
                        }
                    ]
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    http = ThreadingHTTPServer(("127.0.0.1", 0), Catalog)
    http_thread = threading.Thread(target=http.serve_forever, daemon=True)
    http_thread.start()
    state = {"submitted": 0, "status": 1, "folder": ""}

    def listing(req, context):
        files = []
        if req.path == state["folder"] and state["status"] == 2:
            files = [M["CloudDriveFile"](name="film.mkv", fullPathName=req.path + "/film.mkv", size=100)]
        yield M["SubFilesReply"](subFiles=files)

    def mkdir(req, context):
        return M["CreateFolderResult"](result=M["FileOperationResult"](success=True))

    def submit(req, context):
        state["submitted"] += 1
        state["folder"] = req.toFolder
        return M["FileOperationResult"](success=True)

    def status(req, context):
        return M["OfflineFileListResult"](
            offlineFiles=[M["OfflineFile"](infoHash=hash_, status=state["status"])]
        )

    server = grpc.server(ThreadPoolExecutor(max_workers=2))
    handlers = {}
    for name, request, function, streaming in [
        ("GetSubFiles", "ListSubFileRequest", listing, True),
        ("CreateFolder", "CreateFolderRequest", mkdir, False),
        ("AddOfflineFiles", "AddOfflineFileRequest", submit, False),
        ("ListOfflineFilesByPath", "FileRequest", status, False),
    ]:
        factory = grpc.unary_stream_rpc_method_handler if streaming else grpc.unary_unary_rpc_method_handler
        handlers[name] = factory(
            function,
            request_deserializer=M[request].FromString,
            response_serializer=lambda m: m.SerializeToString(),
        )
    server.add_generic_rpc_handlers(
        (grpc.method_handlers_generic_handler("clouddrive.CloudDriveFileSrv", handlers),)
    )
    port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    try:
        app = create_app(tmp_path, worker=False)
        c = TestClient(app)
        c.headers["Authorization"] = "Bearer " + app.state.store.token
        assert (
            c.post(
                "/api/connections",
                json={
                    "name": "Isolated catalog",
                    "kind": "json",
                    "config": {"url": f"http://127.0.0.1:{http.server_port}/catalog.json"},
                },
            ).status_code
            == 200
        )
        cd = c.post(
            "/api/connections",
            json={
                "name": "Protocol fixture",
                "kind": "cd2",
                "config": {"url": f"http://127.0.0.1:{port}", "token": "test-token", "root": "/115/Movies"},
            },
        ).json()
        sub = c.post(
            "/api/subscriptions",
            json={
                "name": "Fixture watchlist",
                "user_id": "example",
                "auto_download": True,
                "downloader_id": cd["id"],
            },
        ).json()
        engine = app.state.engine
        engine.ingest(sub["id"], [{"subject_id": "old", "title": "Historical"}])
        engine.search_waiting()
        assert c.get("/api/tasks").json() == []
        added = [{"subject_id": "new", "title": "Independent Test Film", "year": 2026}]
        engine.ingest(sub["id"], added)
        engine.search_waiting()
        engine.ingest(sub["id"], added)
        engine.search_waiting()
        jobs = c.get("/api/tasks").json()
        assert len(jobs) == 1
        job = jobs[0]
        app.state.engine.tick()
        assert c.get("/api/tasks").json()[0]["status"] == "downloading"
        restarted = create_app(tmp_path, worker=False)
        restarted.state.store.recover()
        state["status"] = 2
        restarted.state.engine.tick()
        library = c.get("/api/library").json()
        assert len(library) == 1 and library[0]["files"][0]["name"] == "film.mkv"
        assert library[0]["id"] == job["id"]
        assert state["submitted"] == 1
    finally:
        server.stop(0).wait()
        http.shutdown()
        http.server_close()
