"""Tests for settings persistence and the auth-token decision.

Both guard against silent data loss: the settings file holds the user's
remembered folder list, and the token is the only thing standing between a
local web page and POST /trash.
"""

import os

import pytest

from dpcleaner import config_store


@pytest.fixture
def cfg_path(tmp_path, monkeypatch):
    p = tmp_path / "dpcleaner.json"
    monkeypatch.setattr(config_store, "CONFIG_PATH", str(p))
    return p


# ---- settings persistence ------------------------------------------------


def test_load_returns_empty_when_missing(cfg_path):
    assert config_store.load_config() == {}


def test_save_then_load_round_trips(cfg_path):
    config_store.save_config({"folders": ["C:/pics"], "threshold": 0.7})
    assert config_store.load_config() == {"folders": ["C:/pics"], "threshold": 0.7}


def test_update_merges_without_dropping_other_keys(cfg_path):
    config_store.save_config({"folders": ["C:/pics"], "lang": "zh"})
    out = config_store.update_config({"threshold": 0.8})
    assert out == {"folders": ["C:/pics"], "lang": "zh", "threshold": 0.8}
    assert config_store.load_config() == out


# Regression: save_config used to open(path, "w"), which truncates before
# writing. A failure (or a concurrent read) mid-write left invalid JSON, which
# load_config reported as {} -- and the next save persisted that emptiness over
# the user's folder list.
def test_a_failed_write_leaves_the_previous_file_intact(cfg_path, monkeypatch):
    config_store.save_config({"folders": ["C:/keep-me"]})

    def boom(*a, **kw):
        raise OSError("disk full")

    monkeypatch.setattr(config_store.json, "dump", boom)
    with pytest.raises(OSError):
        config_store.save_config({"folders": []})

    # the old content survives, and no temp file is left behind
    assert config_store.load_config() == {"folders": ["C:/keep-me"]}
    leftovers = [f for f in os.listdir(cfg_path.parent) if f.endswith(".tmp")]
    assert leftovers == []


def test_save_failure_propagates_so_the_ui_can_report_it(cfg_path, monkeypatch):
    monkeypatch.setattr(
        config_store.json, "dump", lambda *a, **kw: (_ for _ in ()).throw(OSError("nope"))
    )
    with pytest.raises(OSError):
        config_store.update_config({"threshold": 0.5})


def test_corrupt_file_reads_as_empty_rather_than_crashing(cfg_path):
    cfg_path.write_text('{"folders": [', encoding="utf-8")
    assert config_store.load_config() == {}


def test_settings_endpoint_reports_a_failed_save(cfg_path, monkeypatch):
    from fastapi.testclient import TestClient
    from dpcleaner.app import app, configure_token

    configure_token(None)
    monkeypatch.setattr(
        config_store.json, "dump", lambda *a, **kw: (_ for _ in ()).throw(OSError("nope"))
    )
    r = TestClient(app).post("/settings", json={"values": {"threshold": 0.5}})
    assert r.status_code == 500


# ---- auth token ----------------------------------------------------------
# Regression: the check was `token is None`, so DPC_TOKEN="" skipped minting
# and left the guard disarmed while the handshake still printed "token=".


def _resolve(monkeypatch, **env):
    import server_main

    for k in ("DPC_TOKEN", "DPC_DEV"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    return server_main.resolve_token()


def test_empty_token_env_still_mints_a_real_token(monkeypatch):
    assert _resolve(monkeypatch, DPC_TOKEN="") not in (None, "")


def test_unset_token_env_mints_a_real_token(monkeypatch):
    assert _resolve(monkeypatch) not in (None, "")


def test_injected_token_is_honoured(monkeypatch):
    assert _resolve(monkeypatch, DPC_TOKEN="from-parent") == "from-parent"


def test_dev_mode_disables_the_token_deliberately(monkeypatch):
    assert _resolve(monkeypatch, DPC_DEV="1") is None


def test_bad_token_is_rejected(cfg_path):
    from fastapi.testclient import TestClient
    from dpcleaner.app import app, configure_token

    configure_token("right-token")
    try:
        client = TestClient(app)
        assert client.get("/settings").status_code == 401
        assert client.get("/settings", headers={"x-dpc-token": "wrong"}).status_code == 401
        ok = client.get("/settings", headers={"x-dpc-token": "right-token"})
        assert ok.status_code == 200
        # /health stays open so the shell can probe readiness
        assert client.get("/health").status_code == 200
    finally:
        configure_token(None)


def test_threshold_is_clamped(cfg_path):
    """A threshold at/below the -1.0 mask value would match every n^2 pair."""
    from dpcleaner.app import _clamp_threshold

    assert _clamp_threshold(-1.0) == 0.0
    assert _clamp_threshold(-999) == 0.0
    assert _clamp_threshold(5.0) == 1.0
    assert _clamp_threshold(0.6) == 0.6


# ---- portable data dir ---------------------------------------------------
# The portable build must keep everything beside the executable; the Tauri
# shell signals that with DPC_DATA_DIR before spawning us.


def test_data_dir_defaults_to_home(monkeypatch):
    monkeypatch.delenv("DPC_DATA_DIR", raising=False)
    import importlib
    from dpcleaner import paths

    importlib.reload(paths)
    assert paths.DATA_DIR == os.path.abspath(os.path.expanduser("~"))
    assert paths.data_path(".dpcleaner.json") == os.path.join(paths.DATA_DIR, ".dpcleaner.json")


def test_data_dir_follows_env(monkeypatch, tmp_path):
    monkeypatch.setenv("DPC_DATA_DIR", str(tmp_path))
    import importlib
    from dpcleaner import paths

    importlib.reload(paths)
    try:
        assert paths.DATA_DIR == os.path.abspath(str(tmp_path))
        # every persisted file follows, not just the settings
        assert paths.data_path(".cache", "sscd", "m.pt").startswith(str(tmp_path))
    finally:
        monkeypatch.delenv("DPC_DATA_DIR", raising=False)
        importlib.reload(paths)
