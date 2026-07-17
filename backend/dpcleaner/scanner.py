"""Port: collect candidate image files from folders."""

from __future__ import annotations

from typing import Protocol

from .models import ScannedFile


class ImageScanner(Protocol):
    def scan(self, folders: list[str]) -> list[ScannedFile]: ...
