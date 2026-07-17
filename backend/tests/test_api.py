"""API-level tests with crafted embeddings (no torch inference / model download).

We inject a hand-built EmbeddedSet straight into the session, then exercise the
grouping, stats, thumbnail and token-guard paths via TestClient. There is no
keeper concept: every member is just a comparable image.
"""

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from dpcleaner.models import ImageInfo, EmbeddedSet
from dpcleaner.app import app, configure_token
from dpcleaner.container import SESSION


def _unit(vec):
    v = np.asarray(vec, dtype=np.float32)
    return v / np.linalg.norm(v)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def fresh_session():
    """Reset shared singleton state around every test."""
    SESSION.embedded = None
    SESSION.deleted.clear()
    SESSION.undo_stack.clear()
    configure_token(None)
    yield
    configure_token(None)


def _inject_two_dupes_one_unique():
    # v0 ~ v1 (cosine 0.99), v2 orthogonal -> one group of 2, one ungrouped image.
    embs = np.stack(
        [
            _unit([1.0, 0.0, 0.0, 0.0]),
            _unit([0.99, np.sqrt(1 - 0.99**2), 0.0, 0.0]),
            _unit([0.0, 0.0, 1.0, 0.0]),
        ]
    )
    infos = [
        ImageInfo(r"D:\pics\a.png", 200, 200, 5000),
        ImageInfo(r"D:\pics\b.jpg", 100, 100, 800),
        ImageInfo(r"D:\pics\c.png", 100, 100, 800),
    ]
    SESSION.embedded = EmbeddedSet(infos=infos, embs=embs, flips=embs.copy(), total_files=3)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_groups_and_stats(client):
    _inject_two_dupes_one_unique()
    r = client.get("/groups", params={"threshold": 0.6})
    assert r.status_code == 200
    data = r.json()
    assert len(data["groups"]) == 1
    g = data["groups"][0]
    assert len(g["members"]) == 2
    # no keeper fields exist any more
    assert "keeper_path" not in g
    assert all("is_keeper" not in m for m in g["members"])
    assert g["total_size"] == 5800
    # stats are keeper-free: group count + total images in groups
    assert data["stats"] == {"groups": 1, "images": 2}


def test_threshold_too_high_yields_no_groups(client):
    _inject_two_dupes_one_unique()
    r = client.get("/groups", params={"threshold": 0.999})
    assert r.json()["groups"] == []
    assert r.json()["stats"] == {"groups": 0, "images": 0}


def test_thumb_renders(client, tmp_path):
    p = tmp_path / "img.png"
    Image.new("RGB", (64, 48), (200, 30, 30)).save(p)
    r = client.get("/thumb", params={"path": str(p), "size": 32})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert len(r.content) > 0


def test_thumb_404_on_missing(client):
    r = client.get("/thumb", params={"path": r"D:\nope\missing.png"})
    assert r.status_code == 404


def test_token_guard(client):
    configure_token("secret")
    try:
        assert client.get("/groups").status_code == 401
        ok = client.get("/groups", headers={"x-dpc-token": "secret"})
        assert ok.status_code == 200
        # query-param token works too (used by <img> tags)
        assert client.get("/groups", params={"token": "secret"}).status_code == 200
        # /health stays open even with a token configured
        assert client.get("/health").status_code == 200
    finally:
        configure_token(None)
