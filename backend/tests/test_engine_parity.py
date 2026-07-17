"""End-to-end parity check against the REAL SSCD engine.

Slow (runs actual embeddings, may download the 94 MB model on first run), so it
only runs when DPC_RUN_SLOW=1. It builds the synthetic variant battery from
tools/selftest.py and asserts the backend clusters artwork A's variants together.

    DPC_RUN_SLOW=1 .venv/Scripts/python.exe -m pytest tests/test_engine_parity.py
"""

import os

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("DPC_RUN_SLOW") != "1",
    reason="slow engine test; set DPC_RUN_SLOW=1 to run",
)


def test_backend_clusters_synthetic_variants(tmp_path):
    from synthetic import build_test_set  # sibling module in tests/

    # build_test_set writes into tests/_selftest; that's fine for a dev machine.
    truth = build_test_set()
    folder = os.path.dirname(truth["A"][0])

    from dpcleaner.container import SESSION
    from dpcleaner.serializers import groups_to_dict

    SESSION.start_scan([folder])
    SESSION._worker.join(timeout=600)
    assert SESSION.progress.phase == "done", SESSION.progress.error

    data = groups_to_dict(*SESSION.grouped(0.55), threshold=0.55)
    groups = data["groups"]
    # Artwork A's 5 variants should land in one cluster.
    a_names = {os.path.basename(p) for p in truth["A"]}
    matched = [g for g in groups if a_names & {m["name"] for m in g["members"]}]
    assert matched, "no group contained artwork A variants"
    biggest = max(matched, key=lambda g: len(g["members"]))
    assert len(biggest["members"]) >= 3  # most of A's variants clustered together
    assert data["stats"]["groups"] == len(groups)
