"""Port: move files to the OS recycle bin and restore them.

Both methods follow the ``(ok, failed)`` convention, where ``failed`` is a list
of ``(path, error_message)`` and a single failure never aborts the batch.
"""

from __future__ import annotations

from typing import Protocol


class TrashGateway(Protocol):
    def trash_many(self, paths: list[str]) -> tuple[list[str], list[tuple[str, str]]]: ...

    def restore_many(self, paths: list[str]) -> tuple[list[str], list[tuple[str, str]]]: ...
