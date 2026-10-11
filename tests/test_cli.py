import importlib.util
import os
import socket
import subprocess
import sys
import threading
import time

import uvicorn


def test_cli_calls_same_server_and_exports_json(tmp_path):
    assert importlib.util.find_spec("cinebridge.cli"), "CLI missing"
    from cinebridge.app import create_app

    app = create_app(tmp_path, worker=False)
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level="error"))
    thread = threading.Thread(target=lambda: server.run(sockets=[listener]), daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.02)
    env = dict(os.environ, CINEBRIDGE_URL=f"http://127.0.0.1:{port}", CINEBRIDGE_DATA=str(tmp_path))

    def run(*args):
        return subprocess.run(
            [sys.executable, "-m", "cinebridge", *args], env=env, capture_output=True, text=True
        )

    try:
        r = run("import", "--title", "Public Test", "--magnet", "magnet:?xt=urn:btih:" + "ab" * 20)
        assert r.returncode == 0, r.stderr
        r = run("search", "Public", "--json")
        assert r.returncode == 0 and "Public Test" in r.stdout
        assert app.state.store.token not in r.stdout
        r = run("tasks", "--json")
        assert r.returncode == 0 and r.stdout.strip() == "[]"
    finally:
        server.should_exit = True
        thread.join(timeout=3)
        listener.close()
