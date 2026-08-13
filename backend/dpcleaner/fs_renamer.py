"""Batch-rename the image files in a folder to a numeric sequence.

The folder's top-level image files become ``001.ext``, ``002.ext`` ... (zero
padded so a file manager sorts them correctly). Non-image files and any
sub-folders are left untouched.

Renaming is **two-phase**: every source is first moved to a unique temp name in
the same directory, then each temp is moved to its final name. This lets a new
number reuse a name currently held by another file in the same batch without one
rename clobbering another (e.g. shifting ``2.jpg`` -> ``1.jpg`` while a real
``1.jpg`` also exists in the set).

Because phase 1 leaves every file under a meaningless UUID name, the plan is
journalled to disk first (see ``_write_journal``) and rolled back by
``recover_folder`` if the process dies mid-batch.

Return values follow the ``(ok, failed)`` convention, where ``failed`` is a list
of ``(path, error_message)`` and a single failure never aborts the rest of the
batch. Implements the ``interfaces.renamer.Renamer`` port.
"""

from __future__ import annotations

import json
import logging
import os
import re
import uuid

from .models import IMAGE_EXTS

logger = logging.getLogger(__name__)

_NUM_RE = re.compile(r"(\d+)")

# Characters that must never reach a filename we build from user input. The
# path separators are the dangerous ones: the prefix is concatenated into a
# name that goes through ``os.path.join(folder, name)``, and on Windows
# ``join`` *discards* its first argument when the second is drive-rooted -- so
# a prefix of ``C:\x\`` or ``..\`` relocates the entire batch out of the folder.
# The rest are simply illegal in NTFS names.
_BAD_NAME_RE = re.compile(r'[\\/:*?"<>|\x00]')

# Journal of an in-flight batch, written into the folder being renamed.
JOURNAL_NAME = ".dpcleaner-rename.json"


def _natural_key(name: str):
    """Sort key so ``img2`` precedes ``img10`` (digit runs compared as numbers)."""
    return [int(t) if t.isdigit() else t.lower() for t in _NUM_RE.split(name)]


def _list_images(folder: str) -> list[os.DirEntry]:
    """Top-level image files in ``folder`` (no recursion, no directories)."""
    out: list[os.DirEntry] = []
    with os.scandir(folder) as it:
        for e in it:
            try:
                if not e.is_file():
                    continue
            except OSError:
                continue
            if os.path.splitext(e.name)[1].lower() in IMAGE_EXTS:
                out.append(e)
    return out


# ---- crash journal ----
def _journal_path(folder: str) -> str:
    return os.path.join(folder, JOURNAL_NAME)


def _write_journal(folder: str, staged: list[tuple[str, str, str]]) -> None:
    """Record the ``(tmp, final, old)`` plan before the first file is moved.

    Without this on disk, losing the process during phase 1 leaves every file
    named ``<uuid>.dpctmp`` with no surviving mapping back to its original
    name -- and the Tauri shell force-kills the backend on app exit, so simply
    closing the window during a large rename is enough to trigger it.
    """
    path = _journal_path(folder)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(staged, f)
    os.replace(tmp, path)  # atomic: a torn journal is worse than none


def _clear_journal(folder: str) -> None:
    try:
        os.remove(_journal_path(folder))
    except FileNotFoundError:
        pass
    except OSError:
        logger.exception("could not remove rename journal in %s", folder)


def recover_folder(folder: str) -> list[tuple[str, str]]:
    """Roll back a rename batch that was interrupted mid-flight.

    Returns the ``(tmp, restored_to)`` pairs recovered. Safe to call on any
    folder -- a missing or unreadable journal is a no-op. Entries whose temp
    file is gone already reached their final name and are left alone.
    """
    path = _journal_path(folder)
    try:
        with open(path, encoding="utf-8") as f:
            staged = json.load(f)
    except FileNotFoundError:
        return []
    except Exception:  # noqa: BLE001 - a corrupt journal must not block renaming
        logger.exception("unreadable rename journal at %s", path)
        return []

    restored: list[tuple[str, str]] = []
    for entry in staged:
        try:
            tmp, _final, old = entry
        except (TypeError, ValueError):
            continue
        if not os.path.exists(tmp):
            continue  # already at its final name, or never staged
        if os.path.exists(old):
            logger.warning("cannot restore %s: %s is occupied", tmp, old)
            continue
        try:
            os.rename(tmp, old)
            restored.append((tmp, old))
        except OSError:
            logger.exception("could not restore %s -> %s", tmp, old)
    if restored:
        logger.info("recovered %d interrupted rename(s) in %s", len(restored), folder)
    _clear_journal(folder)
    return restored


def plan_renames(
    folder: str,
    *,
    start: int = 1,
    pad: int | None = None,
    prefix: str = "",
    order: str = "name",
) -> list[tuple[str, str]]:
    """Compute the ``(old_abs, new_abs)`` mapping without touching the disk.

    ``pad`` is the minimum number of digits; if ``None``/0 it auto-fits the
    largest number. ``order`` is ``name`` (natural), ``date`` (mtime) or
    ``size``. The original extension (and its case) is preserved.

    Raises ``ValueError`` if ``prefix`` contains a path separator or any other
    character illegal in a filename.
    """
    if _BAD_NAME_RE.search(prefix):
        raise ValueError('前綴不可包含 \\ / : * ? " < > | 等字元')

    folder = os.path.abspath(folder)
    # Heal a batch interrupted by an earlier crash before planning a new one,
    # otherwise the leftover .dpctmp files are invisible to _list_images and
    # their original names are lost for good.
    recover_folder(folder)

    entries = _list_images(folder)
    if order == "date":
        entries.sort(key=lambda e: (e.stat().st_mtime, _natural_key(e.name)))
    elif order == "size":
        entries.sort(key=lambda e: (e.stat().st_size, _natural_key(e.name)))
    else:  # "name"
        entries.sort(key=lambda e: _natural_key(e.name))

    n = len(entries)
    if n == 0:
        return []

    auto = max(len(str(start + n - 1)), 1)
    width = max(int(pad or 0), auto)

    mapping: list[tuple[str, str]] = []
    for i, e in enumerate(entries):
        ext = os.path.splitext(e.name)[1]  # keep original extension + case
        new_name = f"{prefix}{start + i:0{width}d}{ext}"
        new_abs = os.path.join(folder, new_name)
        # The prefix check above should make this impossible, but a target
        # outside the folder means moving the user's photos somewhere they
        # didn't ask for -- verify rather than trust the name we just built.
        if os.path.dirname(os.path.abspath(new_abs)) != folder:
            raise ValueError(f"重新命名的目標超出資料夾範圍：{new_name!r}")
        mapping.append((os.path.join(folder, e.name), new_abs))
    return mapping


def apply_renames(mapping) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    """Perform a ``(old, new)`` rename mapping two-phase. Returns ``(ok, failed)``
    where ``ok`` is a list of ``(old, new)`` actually renamed (incl. no-ops)."""
    ok: list[tuple[str, str]] = []
    failed: list[tuple[str, str]] = []
    if not mapping:
        return ok, failed

    sources = {os.path.normcase(o) for o, _ in mapping}
    folder = os.path.dirname(mapping[0][0])

    # Build the whole staging plan first so it can be journalled before any
    # file moves.
    staged: list[tuple[str, str, str]] = []  # (temp, final, old)
    for old_abs, new_abs in mapping:
        # Exact match only: a case-only change (P1.jpg -> p1.jpg) is a real
        # rename, and normcase would wrongly report it as already done.
        if old_abs == new_abs:
            ok.append((old_abs, new_abs))  # already correctly named
            continue
        # Never overwrite a pre-existing file that isn't part of this batch.
        if os.path.exists(new_abs) and os.path.normcase(new_abs) not in sources:
            failed.append((old_abs, "目標檔名已存在（非本批次檔案），未覆蓋"))
            continue
        tmp = os.path.join(os.path.dirname(old_abs), f"{uuid.uuid4().hex}.dpctmp")
        staged.append((tmp, new_abs, old_abs))

    if not staged:
        return ok, failed

    try:
        _write_journal(folder, staged)
    except OSError:
        # A read-only folder can't be renamed in anyway, but don't proceed
        # unjournalled -- that's the exact scenario the journal exists for.
        logger.exception("could not write rename journal in %s", folder)
        for _tmp, _final, old_abs in staged:
            failed.append((old_abs, "無法寫入還原記錄，未執行重新命名"))
        return ok, failed

    # Phase 1: move each source to its unique temp name.
    moved: list[tuple[str, str, str]] = []
    for tmp, new_abs, old_abs in staged:
        try:
            os.rename(old_abs, tmp)
        except Exception as e:  # noqa: BLE001 - report, keep going
            failed.append((old_abs, str(e)))
            continue
        moved.append((tmp, new_abs, old_abs))

    # Phase 2: move each temp to its final name.
    for tmp, final_abs, old_abs in moved:
        try:
            os.rename(tmp, final_abs)
            ok.append((old_abs, final_abs))
        except Exception as e:  # noqa: BLE001
            try:  # best effort: restore the original name, don't leave .dpctmp
                os.rename(tmp, old_abs)
            except Exception:
                pass
            failed.append((old_abs, str(e)))

    _clear_journal(folder)
    return ok, failed


def undo_renames(pairs) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    """Reverse a previously applied set of ``(old, new)`` renames (new -> old)."""
    return apply_renames([(new, old) for old, new in pairs])


class FilesystemRenamer:
    """``Renamer`` backed by two-phase ``os.rename`` on the local filesystem."""

    def plan(self, folder, *, start=1, pad=None, prefix="", order="name"):
        return plan_renames(folder, start=start, pad=pad, prefix=prefix, order=order)

    def apply(self, mapping):
        return apply_renames(mapping)

    def undo(self, pairs):
        return undo_renames(pairs)
