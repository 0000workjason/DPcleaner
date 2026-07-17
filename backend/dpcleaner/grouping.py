"""Group near-duplicate images from embeddings.

Similarity is cosine on L2-normalised vectors. To stay flip-invariant we also
compare each image against the mirror embeddings of the others and keep the
larger of the two scores. Edges above ``threshold`` are merged with union-find
so every version of one artwork lands in a single group.
"""

from __future__ import annotations

import numpy as np
import torch  # ponytail: numeric primitive (GPU matmul), not an architectural framework — no port for a dot product


class UnionFind:
    def __init__(self, n: int):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x: int) -> int:
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:  # path compression
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1


def find_duplicate_groups(
    embs: np.ndarray,
    flips: np.ndarray,
    threshold: float = 0.60,
    device: str | None = None,
    chunk: int = 2048,
):
    """Return ``(groups, pair_sim)``.

    ``groups`` is a list of clusters (each a sorted list of row indices, size>=2).
    ``pair_sim`` maps ``(i, j)`` with ``i < j`` to their cosine similarity.
    """
    n = len(embs)
    if n < 2:
        return [], {}

    device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    E = torch.from_numpy(np.ascontiguousarray(embs, dtype=np.float32)).to(device)
    F = torch.from_numpy(np.ascontiguousarray(flips, dtype=np.float32)).to(device)

    uf = UnionFind(n)
    pair_sim: dict[tuple[int, int], float] = {}

    for i0 in range(0, n, chunk):
        i1 = min(n, i0 + chunk)
        block = E[i0:i1]  # [b, D]
        s = torch.maximum(block @ E.t(), block @ F.t())  # [b, n], flip-aware

        # Keep only the strict upper triangle (j > global row index).
        rows = torch.arange(i0, i1, device=device).unsqueeze(1)
        cols = torch.arange(n, device=device).unsqueeze(0)
        s = torch.where(cols > rows, s, torch.full_like(s, -1.0))

        hits = (s >= threshold).nonzero(as_tuple=False)
        for r, j in hits.tolist():
            i = i0 + r
            uf.union(i, j)
            pair_sim[(i, j)] = float(s[r, j].item())

    groups_map: dict[int, list[int]] = {}
    for i in range(n):
        groups_map.setdefault(uf.find(i), []).append(i)
    groups = [sorted(idx) for idx in groups_map.values() if len(idx) > 1]
    # Largest / most-similar clusters first for nicer review order.
    groups.sort(key=len, reverse=True)
    return groups, pair_sim
