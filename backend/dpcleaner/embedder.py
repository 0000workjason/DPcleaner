"""Port: turn image files into SSCD embeddings (image + horizontal flip)."""

from __future__ import annotations

from typing import Callable, Protocol

from .models import ScannedFile


class Embedder(Protocol):
    def embed_paths(
        self,
        scanned: list[ScannedFile],
        progress_cb: Callable[[int, int], None] | None = None,
    ) -> dict[str, tuple]:
        """Return ``path -> (width, height, emb, emb_flip)`` for each file that
        embedded successfully (files that fail to decode are dropped)."""
        ...
