"""Composition root: wire concrete adapters into the use-cases.

This is the one place that knows both the ports and their implementations. The
resulting ``dedupe`` / ``rename`` singletons are the app's session state (one
desktop user over loopback). ``SESSION`` is kept as an alias for tests that
inject state directly.
"""

from __future__ import annotations

from .dedupe import DedupeService
from .fs_renamer import FilesystemRenamer
from .fs_scanner import FilesystemScanner
from .rename import RenameService
from .sqlite_repo import DEFAULT_DB, SqliteEmbeddingRepository, purge_disk_cache
from .sscd_embedder import DEFAULT_MODEL, make_embedder
from .trash_gateway import WindowsTrashGateway


def _make_repo() -> SqliteEmbeddingRepository:
    # In-memory only (privacy); clear any stale on-disk cache left by older builds.
    purge_disk_cache(DEFAULT_DB)
    return SqliteEmbeddingRepository(":memory:", DEFAULT_MODEL, check_same_thread=False)


dedupe = DedupeService(
    scanner=FilesystemScanner(),
    embedder_factory=make_embedder,  # (device) -> Embedder
    repo_factory=_make_repo,
    trash_gateway=WindowsTrashGateway(),
)

rename = RenameService(renamer=FilesystemRenamer())

# Back-compat alias for tests that reach into the scan session directly.
SESSION = dedupe
