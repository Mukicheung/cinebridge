import hashlib
import importlib.util
import json

import pytest


def core():
    assert importlib.util.find_spec("cinebridge.core") is not None, "persistent core is not implemented"
    from cinebridge.core import Store, magnet_hash, torrent_magnet

    return Store, magnet_hash, torrent_magnet


def test_magnet_canonicalization_deduplicates_trackers_and_case(tmp_path):
    Store, magnet_hash, _ = core()
    h = "ab" * 20
    assert magnet_hash(f"magnet:?xt=urn:btih:{h.upper()}&dn=test") == h
    s = Store(tmp_path)
    first = s.enqueue("Test", f"magnet:?xt=urn:btih:{h}", "local", "/Movies")
    second = s.enqueue("Different label", f"magnet:?xt=urn:btih:{h.upper()}&tr=x", "local", "/Movies")
    assert first["id"] == second["id"]
    assert len(Store(tmp_path).tasks()) == 1


def test_torrent_hash_uses_original_info_bytes_and_rejects_malformed():
    _, _, torrent_magnet = core()
    info = b"d4:name4:Test6:lengthi12e12:piece lengthi16e6:pieces20:abcdefghijklmnopqrste"
    data = b"d4:info" + info + b"e"
    assert hashlib.sha1(info).hexdigest() in torrent_magnet(data)
    for invalid in [b"", b"d4:info3:abce", data + b"garbage", b"d4:info" + info + b"4:info" + info + b"e"]:
        with pytest.raises(ValueError):
            torrent_magnet(invalid)


def test_secrets_encrypted_and_redacted(tmp_path):
    Store, _, _ = core()
    s = Store(tmp_path)
    c = s.save_connection(
        {
            "name": "Mine",
            "kind": "alist",
            "config": {"url": "https://example.org", "token": "my-super-secret"},
        }
    )
    assert "my-super-secret" not in json.dumps(s.connections())
    assert b"my-super-secret" not in (tmp_path / "cinebridge.db").read_bytes()
    assert s.connection(c["id"], private=True)["config"]["token"] == "my-super-secret"
    s.save_connection(
        {"id": c["id"], "name": "Renamed", "kind": "alist", "config": {"url": "https://example.org"}}
    )
    assert s.connection(c["id"], private=True)["config"]["token"] == "my-super-secret"


def test_restart_marks_inflight_submission_uncertain_not_queued(tmp_path):
    Store, _, _ = core()
    s = Store(tmp_path)
    t = s.enqueue("Test", "magnet:?xt=urn:btih:" + "cd" * 20, "local", "/Movies")
    s.update_task(t["id"], status="submitting")
    s.recover()
    assert s.task(t["id"])["status"] == "needs_review"


def test_task_claim_is_atomic(tmp_path):
    Store, _, _ = core()
    s = Store(tmp_path)
    s.enqueue("Test", "magnet:?xt=urn:btih:" + "ef" * 20, "local", "/Movies")
    assert s.claim() is not None
    assert Store(tmp_path).claim() is None
