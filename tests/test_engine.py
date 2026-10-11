import importlib.util


def setup(tmp_path, remote):
    assert importlib.util.find_spec("cinebridge.engine"), "durable job engine missing"
    from cinebridge.core import Store
    from cinebridge.engine import Engine

    s = Store(tmp_path)
    c = s.save_connection(
        {
            "name": "CD2",
            "kind": "cd2",
            "config": {"url": "http://localhost:19798", "token": "x", "root": "/115/Movies"},
        }
    )
    t = s.enqueue("Test", "magnet:?xt=urn:btih:" + "ab" * 20, c["id"], "/115/Movies")
    return s, Engine(s, downloader_factory=lambda c: remote), t


class Remote:
    def __init__(self):
        self.submissions = 0
        self.state = "downloading"
        self.files = []

    def prepare(self, folder):
        pass

    def submit(self, magnet, folder):
        self.submissions += 1

    def status(self, info_hash, folder):
        return {"status": self.state, "progress": 50}

    def media_files(self, folder):
        return self.files


def test_submit_then_verify_files_before_completion(tmp_path):
    remote = Remote()
    s, e, t = setup(tmp_path, remote)
    e.tick()
    assert s.task(t["id"])["status"] in ("submitted", "downloading")
    remote.state = "finished"
    e.tick()
    assert s.task(t["id"])["status"] == "downloaded"
    remote.files = [{"name": "Test.mkv", "path": "/115/Movies/Test/Test.mkv", "size": 100}]
    e.tick()
    assert s.task(t["id"])["status"] == "completed"
    assert remote.submissions == 1


def test_ambiguous_submission_never_automatically_resubmits(tmp_path):
    remote = Remote()

    def uncertain(*args):
        remote.submissions += 1
        raise TimeoutError("potential credential-bearing upstream error")

    remote.submit = uncertain
    remote.state = "unknown"
    s, e, t = setup(tmp_path, remote)
    e.tick()
    assert s.task(t["id"])["status"] == "needs_review"
    e.tick()
    assert remote.submissions == 1
    assert "credential-bearing" not in str(s.task(t["id"]))
    remote.state = "finished"
    remote.files = [{"name": "Test.mp4", "size": 100, "path": "/115/Movies/Test/Test.mp4"}]
    e.tick()
    assert s.task(t["id"])["status"] == "completed"


def test_subscription_baseline_and_new_item_dedup(tmp_path):
    remote = Remote()
    s, e, t = setup(tmp_path, remote)
    sub = s.save_subscription(
        {
            "name": "Mine",
            "user_id": "example",
            "statuses": ["wish"],
            "downloader_id": t["downloader_id"],
            "auto_download": False,
        }
    )
    e.ingest(sub["id"], [{"subject_id": "1", "title": "Old", "year": 2000}])
    assert s.watchlist()[0]["status"] == "baseline"
    e.ingest(
        sub["id"],
        [
            {"subject_id": "1", "title": "Old", "year": 2000},
            {"subject_id": "2", "title": "New", "year": 2020},
        ],
    )
    assert len(s.watchlist()) == 2
    assert next(x for x in s.watchlist() if x["subject_id"] == "2")["status"] == "waiting"
    assert len(s.tasks()) == 1
