"""SQLite-backed embedding repository.

Embeddings are keyed by (path, size, mtime, model). If a file is edited its
size/mtime change, so a stale embedding is naturally ignored and recomputed.

Implements the ``interfaces.embedding_repo.EmbeddingRepository`` port.
"""

from __future__ import annotations

import os
import sqlite3

import numpy as np

from .paths import data_path

# Default on-disk cache path. The desktop backend uses an in-memory repo for
# privacy and purges this file on first scan; kept here as the canonical location.
DEFAULT_DB = data_path(".dpcleaner_cache.sqlite")


def purge_disk_cache(db_path: str = DEFAULT_DB) -> None:
    """Best-effort delete of an on-disk cache db and its -wal/-shm sidecars."""
    for f in (db_path, db_path + "-wal", db_path + "-shm"):
        try:
            if os.path.exists(f):
                os.remove(f)
        except OSError:
            pass


class SqliteEmbeddingRepository:
    def __init__(self, db_path: str, model_id: str, check_same_thread: bool = True):
        self.model_id = model_id
        # check_same_thread=False lets a single in-memory connection be created on
        # one thread (the server main thread) and reused by the embed worker thread;
        # safe here because scans never overlap, so access is never concurrent.
        self.conn = sqlite3.connect(db_path, check_same_thread=check_same_thread)
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS embeddings (
                path   TEXT NOT NULL,
                size   INTEGER NOT NULL,
                mtime  REAL NOT NULL,
                model  TEXT NOT NULL,
                width  INTEGER,
                height INTEGER,
                emb    BLOB NOT NULL,
                emb_flip BLOB NOT NULL,
                PRIMARY KEY (path, model)
            )
            """
        )
        self.conn.commit()

    def get(self, path: str, size: int, mtime: float):
        """Return (width, height, emb, emb_flip) or None if absent/stale."""
        cur = self.conn.execute(
            "SELECT size, mtime, width, height, emb, emb_flip "
            "FROM embeddings WHERE path=? AND model=?",
            (path, self.model_id),
        )
        row = cur.fetchone()
        if row is None:
            return None
        c_size, c_mtime, w, h, emb, emb_flip = row
        if c_size != size or abs(c_mtime - mtime) > 1e-6:
            return None  # file changed since cached
        return (
            w,
            h,
            np.frombuffer(emb, dtype=np.float32),
            np.frombuffer(emb_flip, dtype=np.float32),
        )

    def put(self, path, size, mtime, width, height, emb, emb_flip):
        self.conn.execute(
            "REPLACE INTO embeddings "
            "(path, size, mtime, model, width, height, emb, emb_flip) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (
                path,
                size,
                mtime,
                self.model_id,
                width,
                height,
                np.ascontiguousarray(emb, dtype=np.float32).tobytes(),
                np.ascontiguousarray(emb_flip, dtype=np.float32).tobytes(),
            ),
        )

    def commit(self):
        self.conn.commit()

    def close(self):
        self.conn.commit()
        self.conn.close()
