"""Presenters: turn domain objects into the JSON shapes the desktop UI expects.

Keeping this out of the use-cases means ``DedupeService`` returns plain domain
``DupGroup``/``Progress`` and never knows about the wire format.
"""

from __future__ import annotations

import hashlib
import os

from .models import DupGroup, Progress


def _group_id(member_paths: list[str]) -> str:
    h = hashlib.sha1("\n".join(sorted(member_paths)).encode("utf-8", "ignore"))
    return h.hexdigest()[:12]


def _times(path: str) -> tuple[float, float]:
    """``(creation, modification)`` time. On Windows st_ctime is the real birth
    time -- i.e. when the file landed on this volume, so a download or a copy
    resets it. mtime survives a copy and some downloaders set it to the artwork's
    publication date, which is why the UI offers both. Zeros on error."""
    try:
        st = os.stat(path)
    except OSError:
        return 0.0, 0.0
    return st.st_ctime, st.st_mtime


def groups_to_dict(
    groups: list[DupGroup], total_files: int, embedded: int, threshold: float
) -> dict:
    groups_out: list[dict] = []
    images = 0
    for g in groups:
        sims = list(g.similarities.values())
        members = []
        for m in g.members:
            images += 1
            ctime, mtime = _times(m.path)
            members.append(
                {
                    "path": m.path,
                    "name": os.path.basename(m.path),
                    "folder": os.path.dirname(m.path),
                    "ext": os.path.splitext(m.path)[1].lower(),
                    "width": m.width,
                    "height": m.height,
                    "size": m.size,
                    "ctime": ctime,
                    "mtime": mtime,
                }
            )
        groups_out.append(
            {
                "id": _group_id([m.path for m in g.members]),
                "members": members,
                "sim_min": min(sims) if sims else 1.0,
                "sim_max": max(sims) if sims else 1.0,
                "total_size": sum(m["size"] for m in members),
            }
        )

    return {
        "threshold": threshold,
        "total_files": total_files,
        "embedded": embedded,
        "groups": groups_out,
        "stats": {"groups": len(groups_out), "images": images},
    }


def progress_to_dict(p: Progress) -> dict:
    return {
        "phase": p.phase,
        "done": p.done,
        "total": p.total,
        "status": p.status,
        "error": p.error,
    }
