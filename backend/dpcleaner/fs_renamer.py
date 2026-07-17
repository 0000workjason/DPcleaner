"""Batch-rename the image files in a folder to a numeric sequence.

The folder's top-level image files become ``001.ext``, ``002.ext`` ... (zero
padded so a file manager sorts them correctly). Non-image files and any
sub-folders are left untouched.

Renaming is **two-phase**: every source is first moved to a unique temp name in
the same directory, then each temp is moved to its final name. This lets a new
number reuse a name currently held by another file in the same batch without one
rename clobbering another (e.g. shifting ``2.jpg`` -> ``1.jpg`` while a real
``1.jpg`` also exists in the set).

Return values follow the ``(ok, failed)`` convention, where ``failed`` is a list
of ``(path, error_message)`` and a single failure never aborts the rest of the
batch. Implements the ``interfaces.renamer.Renamer`` port.
"""

from __future__ import annotations

import os
import re
import uuid

from .models import IMAGE_EXTS

_NUM_RE = re.compile(r"(\d+)")


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
    """
    folder = os.path.abspath(folder)
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
        mapping.append((os.path.join(folder, e.name), os.path.join(folder, new_name)))
    return mapping


def apply_renames(mapping) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    """Perform a ``(old, new)`` rename mapping two-phase. Returns ``(ok, failed)``
    where ``ok`` is a list of ``(old, new)`` actually renamed (incl. no-ops)."""
    ok: list[tuple[str, str]] = []
    failed: list[tuple[str, str]] = []
    if not mapping:
        return ok, failed

    sources = {os.path.normcase(o) for o, _ in mapping}

    # Phase 1: move each source to a unique temp name in its own directory.
    staged: list[tuple[str, str, str]] = []  # (temp, final, old)
    for old_abs, new_abs in mapping:
        if os.path.normcase(old_abs) == os.path.normcase(new_abs):
            ok.append((old_abs, new_abs))  # already correctly named
            continue
        # Never overwrite a pre-existing file that isn't part of this batch.
        if os.path.exists(new_abs) and os.path.normcase(new_abs) not in sources:
            failed.append((old_abs, "目標檔名已存在（非本批次檔案），未覆蓋"))
            continue
        tmp = os.path.join(os.path.dirname(old_abs), f"{uuid.uuid4().hex}.dpctmp")
        try:
            os.rename(old_abs, tmp)
        except Exception as e:  # noqa: BLE001 - report, keep going
            failed.append((old_abs, str(e)))
            continue
        staged.append((tmp, new_abs, old_abs))

    # Phase 2: move each temp to its final name.
    for tmp, final_abs, old_abs in staged:
        try:
            os.rename(tmp, final_abs)
            ok.append((old_abs, final_abs))
        except Exception as e:  # noqa: BLE001
            try:  # best effort: restore the original name, don't leave .dpctmp
                os.rename(tmp, old_abs)
            except Exception:
                pass
            failed.append((old_abs, str(e)))
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
