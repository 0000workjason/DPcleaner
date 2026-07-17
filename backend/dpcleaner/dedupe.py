"""Deduplication use-case: scan → embed(+cache) → cluster, plus trash/undo.

Embedding (slow, GPU, once) is separated from grouping (fast, repeatable) so the
UI can re-cluster live when the user drags a similarity slider without
recomputing any embeddings. Every outside effect — scanning, embedding, the
embedding store, the recycle bin — arrives as an injected port, so this service
holds only orchestration and in-memory session state.

Because it serves exactly one desktop user over loopback, a single instance
(wired in ``web.container``) is sufficient — no per-request sessions. There is no
"keeper" concept: every image in a group is shown equally and the user manually
picks which copies to remove.
"""

from __future__ import annotations

import threading
from typing import Callable

import numpy as np

from .models import ImageInfo, DupGroup, EmbeddedSet, Progress
from .grouping import find_duplicate_groups
from .embedder import Embedder
from .embedding_repo import EmbeddingRepository
from .scanner import ImageScanner
from .trash_gateway_port import TrashGateway


class _Cancelled(Exception):
    pass


class DedupeService:
    def __init__(
        self,
        scanner: ImageScanner,
        embedder_factory: Callable[[str | None], Embedder],
        repo_factory: Callable[[], EmbeddingRepository],
        trash_gateway: TrashGateway,
    ):
        self._scanner = scanner
        self._embedder_factory = embedder_factory  # (device) -> Embedder, deferred (GPU)
        self._repo_factory = repo_factory  # () -> EmbeddingRepository, built once
        self._trash = trash_gateway

        self.progress = Progress()
        self.embedded: EmbeddedSet | None = None
        self.deleted: set[str] = set()
        self.undo_stack: list[dict] = []  # batches of trashed paths, for undo
        self._repo: EmbeddingRepository | None = None
        self._worker: threading.Thread | None = None
        self._cancel = threading.Event()

    # ---- scanning / embedding ----
    def start_scan(self, folders: list[str], device: str | None = None) -> None:
        if self._worker and self._worker.is_alive():
            raise RuntimeError("scan already running")
        self._cancel.clear()
        self.progress.reset()
        self.progress.phase = "scanning"
        self.deleted.clear()
        self.undo_stack.clear()
        self.embedded = None
        # In-memory store only (privacy); the factory also purges any stale
        # on-disk cache left by older builds. Built once, reused across scans.
        if self._repo is None:
            self._repo = self._repo_factory()
        self._worker = threading.Thread(target=self._run_embed, args=(folders, device), daemon=True)
        self._worker.start()

    def _run_embed(self, folders, device):
        try:
            es = self._embed_folders(folders, device)
            self.embedded = es
            self.progress.phase = "done"
            self.progress.status = f"完成：{len(es.infos)} 張可比對"
        except _Cancelled:
            self.progress.phase = "cancelled"
            self.progress.status = "已取消"
        except Exception as e:  # noqa: BLE001
            self.progress.phase = "error"
            self.progress.error = str(e)

    def _embed_folders(self, folders, device) -> EmbeddedSet:
        self.progress.status = "Scanning folders..."
        scanned = self._scanner.scan(folders)
        total = len(scanned)
        if total == 0:
            empty = np.zeros((0, 1), dtype=np.float32)
            return EmbeddedSet([], empty, empty, 0)

        repo = self._repo
        records: dict[str, tuple] = {}  # path -> (w, h, emb, emb_flip)
        misses = []

        self.progress.status = f"Found {total} images. Checking cache..."
        for sf in scanned:
            hit = repo.get(sf.path, sf.size, sf.mtime)
            if hit is not None:
                records[sf.path] = hit
            else:
                misses.append(sf)

        if misses:
            self.progress.status = f"Embedding {len(misses)} new images on {device or 'auto'}..."
            embedder = self._embedder_factory(device)
            fresh = embedder.embed_paths(misses, progress_cb=self._embed_progress)
            by_path = {sf.path: sf for sf in misses}
            for path, (w, h, emb, emb_flip) in fresh.items():
                sf = by_path[path]
                repo.put(path, sf.size, sf.mtime, w, h, emb, emb_flip)
                records[path] = (w, h, emb, emb_flip)
            repo.commit()
        else:
            self.progress.status = "All embeddings served from cache."

        paths = sorted(records.keys())
        sizes = {sf.path: sf.size for sf in scanned}
        infos = [ImageInfo(p, records[p][0], records[p][1], sizes.get(p, 0)) for p in paths]
        if infos:
            embs = np.stack([records[p][2] for p in paths])
            flips = np.stack([records[p][3] for p in paths])
        else:
            embs = flips = np.zeros((0, 1), dtype=np.float32)
        return EmbeddedSet(infos=infos, embs=embs, flips=flips, total_files=total)

    def _embed_progress(self, done, total):
        if self._cancel.is_set():
            raise _Cancelled()
        self.progress.phase = "embedding"
        self.progress.done = done
        self.progress.total = total

    def cancel_scan(self) -> None:
        self._cancel.set()

    def is_scanning(self) -> bool:
        return bool(self._worker and self._worker.is_alive())

    # ---- grouping ----
    def _filtered(self) -> EmbeddedSet | None:
        es = self.embedded
        if es is None:
            return None
        if not self.deleted:
            return es
        keep = [i for i, info in enumerate(es.infos) if info.path not in self.deleted]
        return EmbeddedSet(
            infos=[es.infos[i] for i in keep],
            embs=es.embs[keep],
            flips=es.flips[keep],
            total_files=es.total_files,
        )

    def grouped(self, threshold: float) -> tuple[list[DupGroup], int, int]:
        """Cluster at ``threshold``. Returns ``(groups, total_files, embedded)`` as
        domain objects — turning them into JSON is the presenter's job."""
        es = self._filtered()
        if es is None:
            return [], 0, 0
        if len(es.infos) < 2:
            return [], es.total_files, len(es.infos)
        raw_groups, pair_sim = find_duplicate_groups(es.embs, es.flips, threshold=threshold)
        groups: list[DupGroup] = []
        for g in raw_groups:
            members = [es.infos[i] for i in g]
            inv = {gi: pos for pos, gi in enumerate(g)}  # global idx -> local pos
            sims = {(inv[i], inv[j]): s for (i, j), s in pair_sim.items() if i in inv and j in inv}
            groups.append(DupGroup(members=members, similarities=sims))
        return groups, es.total_files, len(es.infos)

    # ---- destructive actions + undo ----
    def trash(self, paths: list[str]) -> dict:
        ok, failed = self._trash.trash_many(paths)
        self.deleted.update(ok)
        if ok:
            self.undo_stack.append({"kind": "trash", "paths": list(ok)})
        return {"ok": ok, "failed": [{"path": p, "error": e} for p, e in failed]}

    def undo(self) -> dict:
        if not self.undo_stack:
            return {"restored": [], "failed": [], "remaining": 0}
        batch = self.undo_stack.pop()
        ok, failed = self._trash.restore_many(batch["paths"])
        if failed:  # keep the ones that failed so they stay undoable
            self.undo_stack.append({"kind": "trash", "paths": [p for p, _ in failed]})
        self.deleted.difference_update(ok)
        return {
            "restored": ok,
            "failed": [{"path": p, "error": e} for p, e in failed],
            "remaining": len(self.undo_stack),
        }
