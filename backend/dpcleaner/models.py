"""Core domain entities — pure data, no I/O, no framework."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

# Extensions we attempt to decode. webp/jfif are common on Twitter/Pixiv saves.
IMAGE_EXTS = {
    ".jpg",
    ".jpeg",
    ".jfif",
    ".png",
    ".bmp",
    ".gif",
    ".tif",
    ".tiff",
    ".webp",
    ".avif",
}


@dataclass(frozen=True)
class ScannedFile:
    path: str
    size: int
    mtime: float


@dataclass
class ImageInfo:
    path: str
    width: int
    height: int
    size: int


@dataclass
class DupGroup:
    members: list[ImageInfo]
    similarities: dict = field(default_factory=dict)  # (i, j) local idx -> cosine


@dataclass
class EmbeddedSet:
    infos: list[ImageInfo]
    embs: np.ndarray  # [N, D] L2-normalised
    flips: np.ndarray  # [N, D] L2-normalised (mirror)
    total_files: int  # files scanned (incl. ones that failed to embed)


class Progress:
    """Scan/embed progress. Plain mutable attributes, polled by the WebSocket
    handler (no cross-thread asyncio). Serialised by ``web.serializers``."""

    def __init__(self):
        self.reset()

    def reset(self):
        self.phase = "idle"  # idle|scanning|embedding|grouping|done|cancelled|error
        self.done = 0
        self.total = 0
        self.status = ""
        self.error = ""
