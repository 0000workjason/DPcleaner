"""Tests for the folder numeric-rename feature (engine + endpoints).

These don't need real images — rename only cares about filenames/extensions, so
we write tiny byte blobs with image extensions and check the resulting names.
"""

import os

import pytest
from fastapi.testclient import TestClient

from dpcleaner.app import app, configure_token
from dpcleaner.container import rename as RENAME
from dpcleaner.fs_renamer import apply_renames, plan_renames, undo_renames


def _touch(p, data=b"x"):
    with open(p, "wb") as f:
        f.write(data)


def _names(d):
    return sorted(os.listdir(d))


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def fresh_session():
    RENAME.batches.clear()
    configure_token(None)
    yield
    RENAME.batches.clear()
    configure_token(None)


# ---- plan_renames -------------------------------------------------------


def test_plan_natural_order_and_autopad(tmp_path):
    for n in ("img10.jpg", "img2.jpg", "a.png"):
        _touch(tmp_path / n)
    mapping = plan_renames(str(tmp_path), start=1)
    olds = [os.path.basename(o) for o, _ in mapping]
    news = [os.path.basename(n) for _, n in mapping]
    # natural sort: a.png < img2 < img10 ; 3 files -> 1 digit, ext preserved
    assert olds == ["a.png", "img2.jpg", "img10.jpg"]
    assert news == ["1.png", "2.jpg", "3.jpg"]


def test_plan_padding_and_start(tmp_path):
    for n in ("a.jpg", "b.jpg", "c.jpg"):
        _touch(tmp_path / n)
    # start=9 over 3 files -> 9,10,11 -> needs 2 digits even without explicit pad
    news = [os.path.basename(n) for _, n in plan_renames(str(tmp_path), start=9)]
    assert news == ["09.jpg", "10.jpg", "11.jpg"]
    # explicit wider pad is honoured
    news = [os.path.basename(n) for _, n in plan_renames(str(tmp_path), start=1, pad=4)]
    assert news == ["0001.jpg", "0002.jpg", "0003.jpg"]
    # optional prefix
    news = [os.path.basename(n) for _, n in plan_renames(str(tmp_path), prefix="p")]
    assert news == ["p1.jpg", "p2.jpg", "p3.jpg"]


def test_plan_ignores_non_images_and_subdirs(tmp_path):
    _touch(tmp_path / "photo.jpg")
    _touch(tmp_path / "notes.txt")
    (tmp_path / "sub").mkdir()
    _touch(tmp_path / "sub" / "deep.jpg")
    mapping = plan_renames(str(tmp_path), start=1)
    assert [os.path.basename(o) for o, _ in mapping] == ["photo.jpg"]


# ---- apply_renames ------------------------------------------------------


def test_apply_two_phase_no_clobber(tmp_path):
    # 2.jpg -> 1.jpg and 3.jpg -> 2.jpg: target "2.jpg" collides with a live
    # source, which the two-phase rename must handle without losing data.
    _touch(tmp_path / "2.jpg", b"AA")
    _touch(tmp_path / "3.jpg", b"BBB")
    _ok, failed = apply_renames(plan_renames(str(tmp_path), start=1))
    assert failed == []
    assert _names(tmp_path) == ["1.jpg", "2.jpg"]
    assert (tmp_path / "1.jpg").read_bytes() == b"AA"  # was 2.jpg
    assert (tmp_path / "2.jpg").read_bytes() == b"BBB"  # was 3.jpg
    assert not any(n.endswith(".dpctmp") for n in _names(tmp_path))


def test_apply_refuses_out_of_set_overwrite(tmp_path):
    _touch(tmp_path / "src.jpg", b"SRC")
    _touch(tmp_path / "keep.txt", b"KEEP")
    target = tmp_path / "keep.txt"
    ok, failed = apply_renames([(str(tmp_path / "src.jpg"), str(target))])
    assert ok == []
    assert len(failed) == 1
    assert target.read_bytes() == b"KEEP"  # untouched
    assert (tmp_path / "src.jpg").read_bytes() == b"SRC"


def test_apply_noop_when_already_named(tmp_path):
    _touch(tmp_path / "1.jpg")
    mapping = plan_renames(str(tmp_path), start=1)  # -> ("1.jpg" -> "1.jpg")
    _ok, failed = apply_renames(mapping)
    assert failed == []
    assert _names(tmp_path) == ["1.jpg"]


def test_undo_restores_original_names(tmp_path):
    _touch(tmp_path / "alpha.jpg", b"A")
    _touch(tmp_path / "beta.png", b"B")
    mapping = plan_renames(str(tmp_path), start=1)
    ok, _ = apply_renames(mapping)
    assert _names(tmp_path) == ["1.jpg", "2.png"]
    changed = [(o, n) for o, n in ok if os.path.normcase(o) != os.path.normcase(n)]
    _rok, rfailed = undo_renames(changed)
    assert rfailed == []
    assert _names(tmp_path) == ["alpha.jpg", "beta.png"]
    assert (tmp_path / "alpha.jpg").read_bytes() == b"A"


# ---- endpoints ----------------------------------------------------------


def test_endpoints_preview_apply_undo(client, tmp_path):
    for n in ("z.jpg", "y.jpg"):
        _touch(tmp_path / n)
    body = {"folder": str(tmp_path), "start": 1}

    pv = client.post("/rename/preview", json=body).json()
    assert pv["count"] == 2
    assert pv["conflicts"] == []
    assert {i["new"].split(os.sep)[-1] for i in pv["items"]} == {"1.jpg", "2.jpg"}

    ap = client.post("/rename/apply", json=body).json()
    assert ap["renamed"] == 2
    assert ap["batch_id"]
    assert _names(tmp_path) == ["1.jpg", "2.jpg"]

    un = client.post("/rename/undo", json={"batch_id": ap["batch_id"]}).json()
    assert un["ok"] is True
    assert _names(tmp_path) == ["y.jpg", "z.jpg"]


def test_apply_missing_folder_400(client):
    r = client.post("/rename/apply", json={"folder": r"D:\nope\missing", "start": 1})
    assert r.status_code == 400


# ---- prefix must not escape the folder ----------------------------------
# Regression: prefix was concatenated into a filename and passed to
# os.path.join(folder, name). On Windows join *discards* its first argument
# when the second is drive-rooted, so a prefix of "..\" or "C:\x\" relocated
# every image in the folder.


@pytest.mark.parametrize(
    "prefix",
    [
        "..\\",
        "..\\..\\",
        "C:\\Windows\\",
        "\\Windows\\",
        "sub/",
        "a/b",
        "x:y",
        'q"uote',
        "star*",
    ],
)
def test_plan_rejects_prefix_that_escapes_the_folder(tmp_path, prefix):
    _touch(tmp_path / "a.jpg")
    with pytest.raises(ValueError):
        plan_renames(str(tmp_path), start=1, prefix=prefix)
    assert _names(tmp_path) == ["a.jpg"]  # nothing touched


def test_every_planned_target_stays_inside_the_folder(tmp_path):
    for n in ("a.jpg", "b.png", "c.webp"):
        _touch(tmp_path / n)
    folder = os.path.abspath(str(tmp_path))
    for old, new in plan_renames(folder, start=1, prefix="IMG_"):
        assert os.path.dirname(os.path.abspath(new)) == folder


def test_apply_endpoint_rejects_traversal_prefix(client, tmp_path):
    _touch(tmp_path / "a.jpg")
    r = client.post(
        "/rename/apply",
        json={"folder": str(tmp_path), "start": 1, "prefix": "..\\..\\"},
    )
    assert r.status_code == 400
    assert _names(tmp_path) == ["a.jpg"]


def test_harmless_prefix_still_works(tmp_path):
    _touch(tmp_path / "a.jpg")
    _touch(tmp_path / "b.jpg")
    _ok, failed = apply_renames(plan_renames(str(tmp_path), start=1, prefix="pic-"))
    assert failed == []
    assert _names(tmp_path) == ["pic-1.jpg", "pic-2.jpg"]


# ---- crash journal -------------------------------------------------------
# Regression: phase 1 renames everything to <uuid>.dpctmp. Losing the process
# there (the shell force-kills the backend on app exit) used to leave the whole
# folder as unrecoverable UUIDs.


def test_journal_is_written_during_the_batch_and_removed_after(tmp_path, monkeypatch):
    from dpcleaner import fs_renamer

    _touch(tmp_path / "a.jpg")
    _touch(tmp_path / "b.jpg")
    seen = {}
    real = fs_renamer._write_journal

    def spy(folder, staged):
        real(folder, staged)
        seen["path"] = fs_renamer._journal_path(folder)
        seen["exists"] = os.path.exists(seen["path"])

    monkeypatch.setattr(fs_renamer, "_write_journal", spy)
    apply_renames(plan_renames(str(tmp_path), start=1))

    assert seen["exists"] is True  # present while the batch runs
    assert not os.path.exists(seen["path"])  # cleared once it finished
    assert _names(tmp_path) == ["1.jpg", "2.jpg"]


def test_recover_folder_restores_names_after_an_interrupted_phase_one(tmp_path):
    from dpcleaner import fs_renamer

    # Simulate a crash between phase 1 and phase 2: files sitting under UUID
    # temp names, with the journal still on disk.
    tmp_a = tmp_path / "deadbeef.dpctmp"
    tmp_b = tmp_path / "cafebabe.dpctmp"
    _touch(tmp_a, b"A")
    _touch(tmp_b, b"B")
    fs_renamer._write_journal(
        str(tmp_path),
        [
            [str(tmp_a), str(tmp_path / "1.jpg"), str(tmp_path / "alpha.jpg")],
            [str(tmp_b), str(tmp_path / "2.jpg"), str(tmp_path / "beta.jpg")],
        ],
    )

    restored = fs_renamer.recover_folder(str(tmp_path))

    assert len(restored) == 2
    assert _names(tmp_path) == ["alpha.jpg", "beta.jpg"]
    assert (tmp_path / "alpha.jpg").read_bytes() == b"A"
    assert not os.path.exists(fs_renamer._journal_path(str(tmp_path)))


def test_planning_heals_a_crashed_batch_first(tmp_path):
    from dpcleaner import fs_renamer

    stale = tmp_path / "deadbeef.dpctmp"
    _touch(stale, b"A")
    fs_renamer._write_journal(
        str(tmp_path),
        [[str(stale), str(tmp_path / "1.jpg"), str(tmp_path / "alpha.jpg")]],
    )
    # The .dpctmp file is invisible to _list_images, so without recovery the
    # new plan would silently skip it and its original name would be lost.
    mapping = plan_renames(str(tmp_path), start=1)
    assert [os.path.basename(o) for o, _ in mapping] == ["alpha.jpg"]


def test_recover_folder_is_a_no_op_without_a_journal(tmp_path):
    from dpcleaner import fs_renamer

    _touch(tmp_path / "a.jpg")
    assert fs_renamer.recover_folder(str(tmp_path)) == []
    assert _names(tmp_path) == ["a.jpg"]


# ---- case-only renames ---------------------------------------------------
# Regression: normcase made P1.jpg -> p1.jpg compare equal, so it was reported
# as renamed but never actually performed.


def test_case_only_rename_is_actually_performed(tmp_path):
    _touch(tmp_path / "A.jpg", b"A")
    _ok, failed = apply_renames([(str(tmp_path / "A.jpg"), str(tmp_path / "a.jpg"))])
    assert failed == []
    assert os.listdir(tmp_path) == ["a.jpg"]
    assert (tmp_path / "a.jpg").read_bytes() == b"A"
