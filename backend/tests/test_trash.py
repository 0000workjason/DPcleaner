"""Tests for the recycle-bin gateway.

This is the only code in the app that moves the user's files, and restore
parses Windows' ``$I`` metadata by hand. Getting that wrong doesn't raise --
undo either puts an image back in the wrong place or reports it missing while
it sits in the bin, and the README sells undo as the reason it's safe to click
delete.

None of it needs a real recycle bin: ``$I`` is a pure byte format, and
``_bin_index`` only wants a directory tree shaped like one, which is why it
takes the drive as an argument we can point at ``tmp_path``.
"""

from __future__ import annotations

import os
import struct
import sys

import pytest

from dpcleaner.trash_gateway import (
    _bin_index,
    _index_keys,
    _parse_i,
    restore_many,
    to_trash_many,
)

# A recognisable FILETIME (100 ns ticks since 1601); only its ordering matters.
FT = 133_000_000_000_000_000


def _i_v2(orig: str, deleted_at: int = FT, size: int = 4096) -> bytes:
    """A Win10/11 record: version 2, then a length-prefixed UTF-16LE path."""
    path = orig.encode("utf-16-le") + b"\x00\x00"
    return (
        struct.pack("<Q", 2)
        + struct.pack("<Q", size)
        + struct.pack("<Q", deleted_at)
        + struct.pack("<I", len(path) // 2)  # char count, terminator included
        + path
    )


def _i_v1(orig: str, deleted_at: int = FT, size: int = 4096) -> bytes:
    """A Vista..8 record: version 1, then a fixed 520-byte (260 char) field."""
    field = (orig.encode("utf-16-le") + b"\x00\x00").ljust(520, b"\x00")[:520]
    return struct.pack("<Q", 1) + struct.pack("<Q", size) + struct.pack("<Q", deleted_at) + field


def _write_entry(sid_dir, ident: str, orig: str, data: bytes | None = None) -> tuple[str, str]:
    """Write one ``$I``/``$R`` pair. Returns their paths."""
    ip = os.path.join(sid_dir, f"$I{ident}")
    rp = os.path.join(sid_dir, f"$R{ident}")
    with open(ip, "wb") as f:
        f.write(_i_v2(orig) if data is None else data)
    with open(rp, "wb") as f:
        f.write(b"pixels")
    return ip, rp


def _parse(tmp_path, data: bytes):
    """``_parse_i`` reads a file; the byte-level tests want a direct form."""
    p = tmp_path / "$Ifixture"
    p.write_bytes(data)
    return _parse_i(str(p))


@pytest.fixture
def bin_root(tmp_path):
    """A directory tree shaped like one drive's ``$Recycle.Bin``."""
    sid = tmp_path / "$Recycle.Bin" / "S-1-5-21-1111111111-2222222222-3333333333-1001"
    sid.mkdir(parents=True)
    return sid


class TestParseI:
    def test_reads_a_win10_record(self, tmp_path):
        orig = r"C:\Users\me\Pictures\a.png"
        assert _parse(tmp_path, _i_v2(orig)) == (orig, FT)

    def test_reads_a_vista_record(self, tmp_path):
        """The older fixed-width layout is still what an ageing bin on the same
        machine holds, so both versions have to parse."""
        assert _parse(tmp_path, _i_v1(r"D:\art\b.jpg")) == (r"D:\art\b.jpg", FT)

    def test_reads_a_non_ascii_path(self, tmp_path):
        """The whole reason the field is UTF-16 -- this app's own users have CJK
        in their home directory, and a mis-sliced decode corrupts the path
        rather than failing."""
        orig = "C:\\Users\\傑森\\圖片\\插畫 01.png"
        assert _parse(tmp_path, _i_v2(orig))[0] == orig

    def test_rejects_a_truncated_record(self, tmp_path):
        assert _parse(tmp_path, b"\x02" * 23) is None

    def test_rejects_a_record_with_no_path(self, tmp_path):
        assert _parse(tmp_path, _i_v2("")) is None


class TestBinIndex:
    def test_maps_original_paths_to_their_bin_entries(self, tmp_path, bin_root):
        orig = r"C:\Users\me\Pictures\a.png"
        ip, rp = _write_entry(str(bin_root), "ABC123.png", orig)

        idx = _bin_index(str(tmp_path))

        assert idx[_index_keys(orig)[0]] == (ip, rp)

    def test_the_most_recently_deleted_entry_wins(self, tmp_path, bin_root):
        """The bin can hold several entries for one path -- deleted, recreated,
        deleted again, possibly from outside this app. Undo must restore the
        copy that was deleted last, not whichever the directory listing yields
        last."""
        orig = r"C:\Users\me\Pictures\a.png"
        # Names chosen so the OLDER entry is listed last: NTFS hands back
        # os.listdir in name order, so without the timestamp comparison the
        # code would keep this one and undo would restore a stale copy. Naming
        # them the other way round lets a broken tiebreak pass by luck.
        _, newer_r = _write_entry(str(bin_root), "AAA.png", orig, _i_v2(orig, deleted_at=FT + 1))
        _, older_r = _write_entry(str(bin_root), "ZZZ.png", orig, _i_v2(orig, deleted_at=FT))

        idx = _bin_index(str(tmp_path))

        assert idx[_index_keys(orig)[0]][1] == newer_r
        assert older_r != newer_r  # the fixture really did make two entries

    def test_one_unreadable_entry_does_not_hide_the_rest(self, tmp_path, bin_root):
        _write_entry(str(bin_root), "BAD.png", "", b"\xff\xfe garbage")
        good = r"C:\Users\me\Pictures\good.png"
        _, good_r = _write_entry(str(bin_root), "GOOD.png", good)

        idx = _bin_index(str(tmp_path))

        assert idx[_index_keys(good)[0]][1] == good_r

    def test_a_missing_bin_is_empty_not_an_error(self, tmp_path):
        assert _bin_index(str(tmp_path / "nope")) == {}


class TestToTrashMany:
    def test_one_failure_does_not_abort_the_batch(self, monkeypatch):
        """A locked or already-deleted file in the middle of a selection must
        not strand the rest -- the UI reports per-file failures."""
        import dpcleaner.trash_gateway as tg

        def fake(path):
            if "boom" in path:
                raise OSError("in use")

        monkeypatch.setattr(tg, "to_trash", fake)

        ok, failed = to_trash_many(["a.png", "boom.png", "c.png"])

        assert ok == ["a.png", "c.png"]
        assert [p for p, _ in failed] == ["boom.png"]
        assert "in use" in failed[0][1]


@pytest.mark.skipif(sys.platform != "win32", reason="restore is Windows-only by design")
class TestRestoreMany:
    def _fake_index(self, monkeypatch, mapping):
        import dpcleaner.trash_gateway as tg

        monkeypatch.setattr(tg, "_bin_index", lambda drive: mapping)

    def test_restores_the_file_and_drops_the_metadata(self, tmp_path, monkeypatch):
        target = tmp_path / "back" / "a.png"
        ip = tmp_path / "$IABC.png"
        rp = tmp_path / "$RABC.png"
        ip.write_bytes(_i_v2(str(target)))
        rp.write_bytes(b"pixels")
        self._fake_index(monkeypatch, {_index_keys(str(target))[0]: (str(ip), str(rp))})

        ok, failed = restore_many([str(target)])

        assert (ok, failed) == ([str(target)], [])
        assert target.read_bytes() == b"pixels"  # contents, not just the name
        assert not ip.exists()

    def test_refuses_to_overwrite_a_file_back_at_the_original_path(self, tmp_path, monkeypatch):
        """If something already sits there, undo must fail loudly rather than
        destroy it -- that would turn a recoverable delete into a real one."""
        target = tmp_path / "a.png"
        target.write_bytes(b"newer file")
        rp = tmp_path / "$RABC.png"
        rp.write_bytes(b"pixels")
        self._fake_index(monkeypatch, {_index_keys(str(target))[0]: ("ignored", str(rp))})

        ok, failed = restore_many([str(target)])

        assert ok == []
        assert target.read_bytes() == b"newer file"
        assert rp.exists()  # still recoverable

    def test_reports_an_entry_missing_from_the_bin(self, tmp_path, monkeypatch):
        self._fake_index(monkeypatch, {})

        ok, failed = restore_many([str(tmp_path / "gone.png")])

        assert ok == []
        assert len(failed) == 1
