"""Send files to the OS recycle bin (recoverable delete), and restore them.

Implements the ``interfaces.trash_gateway.TrashGateway`` port.
"""

from __future__ import annotations

import logging
import os
import shutil
import struct
import sys

from send2trash import send2trash

logger = logging.getLogger(__name__)


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


def _index_keys(path: str) -> list[str]:
    """Every spelling of ``path`` that a lookup might arrive as.

    $I records the abspath that was passed to the delete, but the caller may
    reach the same file through a junction, a symlink or a subst drive --
    ``C:\\Users\\<me>\\My Pictures`` is a junction on every Windows install, and
    ``_canonical`` resolves those while the recorded path does not. Indexing
    both forms is what makes the two sides meet; keying on only one meant undo
    reported "not found" for files sitting right there in the bin.
    """
    raw = os.path.normcase(os.path.abspath(path))
    canon = _canonical(path)
    return [raw] if raw == canon else [raw, canon]


def _parse_i(i_path: str) -> tuple[str, int] | None:
    """Return ``(original_path, deleted_filetime)`` from a $I file, or None."""
    with open(i_path, "rb") as f:
        data = f.read()
    if len(data) < 24:
        return None
    version = struct.unpack("<Q", data[0:8])[0]
    deleted_at = struct.unpack("<Q", data[16:24])[0]  # FILETIME
    if version == 1:  # Vista..8: fixed 520-byte (260 UTF-16) path field
        orig = data[24 : 24 + 520].decode("utf-16-le", "ignore").split("\x00")[0]
    else:  # version 2 (Win10/11): 4-byte char count, then UTF-16LE path
        n = struct.unpack("<I", data[24:28])[0]
        orig = data[28 : 28 + n * 2].decode("utf-16-le", "ignore").rstrip("\x00")
    return (orig, deleted_at) if orig else None


def _bin_index(drive: str) -> dict[str, tuple[str, str]]:
    """Map normcase(original_path) -> ($I path, $R path) for one drive's recycle
    bin. Only the current user's $Recycle.Bin\\<SID> is readable; other SIDs
    (e.g. SYSTEM) raise PermissionError and are skipped.

    The bin can hold several entries for the same original path (deleted,
    recreated, deleted again -- including deletions made outside this app), so
    the most recently deleted one wins rather than whichever os.listdir
    happened to yield last.
    """
    best: dict[str, tuple[int, str, str]] = {}  # key -> (deleted_at, $I, $R)
    root = os.path.join(drive + os.sep, "$Recycle.Bin")
    try:
        sids = os.listdir(root)
    except OSError:
        return {}
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
                parsed = _parse_i(ip)
            except Exception:
                # Broad on purpose: a malformed $I can fail in more ways than
                # OSError. One unreadable entry must not hide the rest of the
                # bin, but a file skipped here is a file undo will report as
                # missing -- so leave a trace rather than dropping it silently.
                logger.debug("skipping unreadable recycle-bin metadata %s", ip, exc_info=True)
                continue
            if not parsed:
                continue
            orig, deleted_at = parsed
            rp = os.path.join(sdir, "$R" + name[2:])
            for key in _index_keys(orig):
                prev = best.get(key)
                if prev is None or deleted_at >= prev[0]:
                    best[key] = (deleted_at, ip, rp)
    return {k: (ip, rp) for k, (_t, ip, rp) in best.items()}


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
        # Try both the raw and the resolved spelling; the index carries both.
        keys = _index_keys(p)
        entry = next((idx[k] for k in keys if k in idx), None)
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
            for k in keys:
                idx.pop(k, None)
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
