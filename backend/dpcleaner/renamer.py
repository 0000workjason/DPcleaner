"""Port: plan / apply / undo a folder's numeric-sequence rename.

``apply`` and ``undo`` follow the ``(ok, failed)`` convention (see trash_gateway).
"""

from __future__ import annotations

from typing import Protocol


class Renamer(Protocol):
    def plan(
        self,
        folder: str,
        *,
        start: int = 1,
        pad: int | None = None,
        prefix: str = "",
        order: str = "name",
    ) -> list[tuple[str, str]]:
        """Compute the ``(old_abs, new_abs)`` mapping without touching the disk."""
        ...

    def apply(self, mapping) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]: ...

    def undo(self, pairs) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]: ...
