"""Filesystem scanning: collect candidate image files from folders.

Implements the ``interfaces.scanner.ImageScanner`` port.
"""

from __future__ import annotations

import os

from .models import IMAGE_EXTS, ScannedFile


def scan_folders(folders, recursive: bool = True) -> list[ScannedFile]:
    """Return de-duplicated image files found under the given folders.

    Paths are normalised; duplicates (same path reached via multiple folders)
    are collapsed case-insensitively, which matches Windows semantics.
    """
    seen: set[str] = set()
    out: list[ScannedFile] = []

    for folder in folders:
        if not folder or not os.path.isdir(folder):
            continue
        if recursive:
            for root, _dirs, files in os.walk(folder):
                for name in files:
                    _maybe_add(root, name, seen, out)
        else:
            try:
                names = os.listdir(folder)
            except OSError:
                continue
            for name in names:
                _maybe_add(folder, name, seen, out)

    return out


def _maybe_add(root: str, name: str, seen: set[str], out: list[ScannedFile]) -> None:
    ext = os.path.splitext(name)[1].lower()
    if ext not in IMAGE_EXTS:
        return
    path = os.path.normpath(os.path.join(root, name))
    key = path.lower()
    if key in seen:
        return
    try:
        st = os.stat(path)
    except OSError:
        return
    seen.add(key)
    out.append(ScannedFile(path=path, size=st.st_size, mtime=st.st_mtime))


class FilesystemScanner:
    """``ImageScanner`` backed by ``os.walk``."""

    def scan(self, folders: list[str]) -> list[ScannedFile]:
        return scan_folders(folders)
