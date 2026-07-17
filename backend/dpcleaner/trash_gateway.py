"""Send files to the OS recycle bin (recoverable delete), and restore them.

Implements the ``interfaces.trash_gateway.TrashGateway`` port.
"""

from __future__ import annotations

import os
import sys
import struct
import shutil
from send2trash import send2trash


def to_trash(path: str) -> None:
    """Move a single file to the recycle bin. Raises on failure."""
    send2trash(os.path.abspath(path))


def to_trash_many(paths) -> tuple[list[str], list[tuple[str, str]]]:
    """Trash several files. Returns ``(succeeded, failed)`` where ``failed`` is a
    list of ``(path, error_message)``."""
    ok: list[str] = []
    failed: list[tuple[str, str]] = []
    for p in paths:
        try:
            to_trash(p)
            ok.append(p)
        except Exception as e:  # noqa: BLE001 - report, don't crash the batch
            failed.append((p, str(e)))
    return ok, failed


# ---- restore (undo) -------------------------------------------------------
# Windows keeps each deleted file as a pair under <drive>:\$Recycle.Bin\<SID>\ :
#   $R<id><ext>  – the file contents
#   $I<id><ext>  – metadata (original full path + size + delete time)
# Restoring = move the $R file back to its original path and drop the $I. We
# parse $I ourselves (instead of driving the shell's "Restore" verb) so it is
# locale-independent and needs no extra dependency / subprocess.


def _canonical(path: str) -> str:
    """Absolute, lower-cased path with any 8.3 short parent components expanded
    to long form, so it matches the long path the shell records in $I. The leaf
    no longer exists (it's in the bin), so we only resolve its parent."""
    ap = os.path.abspath(path)
    head, tail = os.path.split(ap)
    try:
        head = os.path.realpath(head)  # on Windows this expands 8.3 short names
    except OSError:
        pass
    return os.path.normcase(os.path.join(head, tail))


def _parse_i_original(i_path: str) -> str | None:
    """Return the original full path recorded in a recycle-bin $I file, or None."""
    with open(i_path, "rb") as f:
        data = f.read()
    if len(data) < 24:
        return None
    version = struct.unpack("<Q", data[0:8])[0]
    if version == 1:  # Vista..8: fixed 520-byte (260 UTF-16) path field
        return data[24 : 24 + 520].decode("utf-16-le", "ignore").split("\x00")[0] or None
    # version 2 (Win10/11): 4-byte char count, then UTF-16LE path
    n = struct.unpack("<I", data[24:28])[0]
    return data[28 : 28 + n * 2].decode("utf-16-le", "ignore").rstrip("\x00") or None


def _bin_index(drive: str) -> dict[str, tuple[str, str]]:
    """Map normcase(original_path) -> ($I path, $R path) for one drive's recycle
    bin. Only the current user's $Recycle.Bin\\<SID> is readable; other SIDs
    (e.g. SYSTEM) raise PermissionError and are skipped."""
    idx: dict[str, tuple[str, str]] = {}
    root = os.path.join(drive + os.sep, "$Recycle.Bin")
    try:
        sids = os.listdir(root)
    except OSError:
        return idx
    for sid in sids:
        sdir = os.path.join(root, sid)
        try:
            names = os.listdir(sdir)
        except OSError:
            continue
        for name in names:
            if not name.startswith("$I"):
                continue
            ip = os.path.join(sdir, name)
            try:
                orig = _parse_i_original(ip)
            except Exception:  # noqa: BLE001 - skip unreadable/odd metadata
                continue
            if orig:
                idx[os.path.normcase(orig)] = (ip, os.path.join(sdir, "$R" + name[2:]))
    return idx


def restore_many(paths) -> tuple[list[str], list[tuple[str, str]]]:
    """Restore files previously sent to the recycle bin, matched by their
    original path. Windows-only. Returns ``(restored, failed)``."""
    ok: list[str] = []
    failed: list[tuple[str, str]] = []
    if sys.platform != "win32":
        return ok, [(p, "復原僅支援 Windows") for p in paths]
    caches: dict[str, dict[str, tuple[str, str]]] = {}
    for p in paths:
        ap = os.path.abspath(p)
        drive = os.path.splitdrive(ap)[0]
        if not drive:
            failed.append((p, "無法判斷磁碟機"))
            continue
        idx = caches.get(drive)
        if idx is None:
            idx = caches[drive] = _bin_index(drive)
        key = _canonical(p)  # match the long path the shell stored in $I
        entry = idx.get(key)
        if entry is None:
            failed.append((p, "在回收筒找不到對應項目"))
            continue
        ip, rp = entry
        if os.path.exists(ap):
            failed.append((p, "原位置已有同名檔，未覆蓋"))
            continue
        if not os.path.exists(rp):
            failed.append((p, "回收筒實體檔已遺失"))
            continue
        try:
            os.makedirs(os.path.dirname(ap), exist_ok=True)
            shutil.move(rp, ap)
            try:
                os.remove(ip)  # best-effort metadata cleanup
            except OSError:
                pass
            idx.pop(key, None)
            ok.append(p)
        except Exception as e:  # noqa: BLE001
            failed.append((p, str(e)))
    return ok, failed


class WindowsTrashGateway:
    """``TrashGateway`` using send2trash to delete and $I/$R parsing to restore."""

    def trash_many(self, paths) -> tuple[list[str], list[tuple[str, str]]]:
        return to_trash_many(paths)

    def restore_many(self, paths) -> tuple[list[str], list[tuple[str, str]]]:
        return restore_many(paths)
