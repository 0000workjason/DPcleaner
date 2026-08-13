"""JPEG thumbnail / preview generation for the web UI, with an LRU cache.

Uses the PIL ``draft`` + ``thumbnail`` trick (a fast on-decode downscale for
JPEGs). Keyed by (path, mtime, size) so an edited file re-renders instead of
serving a stale tile.
"""

from __future__ import annotations

import io
import os
from functools import lru_cache

from PIL import Image, ImageFile

ImageFile.LOAD_TRUNCATED_IMAGES = True


def _render(path: str, maxdim: int, quality: int) -> bytes:
    im = Image.open(path)
    if getattr(im, "is_animated", False):
        im.seek(0)
    im.draft("RGB", (maxdim, maxdim))  # cheap downscale during decode (JPEG)
    im = im.convert("RGB")
    im.thumbnail((maxdim, maxdim))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


# Two caches, not one. Gallery tiles are ~15 KB each, but compare-viewer
# previews are 300-800 KB, and `maxdim` is client-controlled and part of the
# key. Sharing a single 3000-entry cache meant browsing a large scan grew
# resident memory towards 1-2 GB and never gave it back.
@lru_cache(maxsize=3000)
def _cached_thumb(path: str, mtime: float, maxdim: int, quality: int) -> bytes:
    return _render(path, maxdim, quality)


@lru_cache(maxsize=48)
def _cached_preview(path: str, mtime: float, maxdim: int, quality: int) -> bytes:
    return _render(path, maxdim, quality)


def _get(cache, path: str, maxdim: int, quality: int) -> bytes | None:
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None
    try:
        return cache(path, mtime, maxdim, quality)
    except Exception:
        return None


def get_thumb(path: str, maxdim: int = 320, quality: int = 80) -> bytes | None:
    return _get(_cached_thumb, path, maxdim, quality)


def get_preview(path: str, maxdim: int = 2048, quality: int = 88) -> bytes | None:
    """Larger image for the compare/zoom viewer (still capped, not the raw file)."""
    return _get(_cached_preview, path, maxdim, quality)


def clear_cache() -> None:
    _cached_thumb.cache_clear()
    _cached_preview.cache_clear()
