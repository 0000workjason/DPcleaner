"""Port: persist/retrieve embeddings, keyed by (path, size, mtime, model)."""

from __future__ import annotations

from typing import Protocol

import numpy as np


class EmbeddingRepository(Protocol):
    def get(self, path: str, size: int, mtime: float) -> tuple | None:
        """Return ``(width, height, emb, emb_flip)`` or ``None`` if absent/stale."""
        ...

    def put(
        self,
        path: str,
        size: int,
        mtime: float,
        width: int,
        height: int,
        emb: np.ndarray,
        emb_flip: np.ndarray,
    ) -> None: ...

    def commit(self) -> None: ...

    def close(self) -> None: ...
