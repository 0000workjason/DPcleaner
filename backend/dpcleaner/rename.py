"""Folder numeric-rename use-case: preview / apply / undo.

Rename batches are keyed by id so each can be undone independently of the trash
undo stack (rename happens on the pre-scan Folders screen, unrelated to a scan
session). Delegates all disk work to an injected ``Renamer`` port.
"""

from __future__ import annotations

import os
import uuid

from .renamer import Renamer

_MAX_BATCHES = 20


class RenameService:
    def __init__(self, renamer: Renamer):
        self._renamer = renamer
        self.batches: dict[str, list[tuple[str, str]]] = {}

    def preview(self, folder, *, start=1, pad=None, prefix="", order="name") -> dict:
        mapping = self._renamer.plan(folder, start=start, pad=pad, prefix=prefix, order=order)
        sources = {os.path.normcase(o) for o, _ in mapping}
        conflicts = [
            new
            for old, new in mapping
            if os.path.normcase(old) != os.path.normcase(new)
            and os.path.exists(new)
            and os.path.normcase(new) not in sources
        ]
        return {
            "items": [{"old": o, "new": n} for o, n in mapping],
            "count": len(mapping),
            "conflicts": conflicts,
        }

    def apply(self, folder, *, start=1, pad=None, prefix="", order="name") -> dict:
        mapping = self._renamer.plan(folder, start=start, pad=pad, prefix=prefix, order=order)
        ok, failed = self._renamer.apply(mapping)
        # Only the renames that actually changed a name are worth undoing.
        # Exact comparison, not normcase: a case-only change (P1.jpg -> p1.jpg)
        # is a real rename and must stay undoable.
        changed = [(o, n) for o, n in ok if o != n]
        batch_id = ""
        if changed:
            batch_id = uuid.uuid4().hex[:12]
            self.batches[batch_id] = changed
            # Bounded so a long session can't grow this without limit; the UI
            # only ever offers undo for the batch it just created.
            while len(self.batches) > _MAX_BATCHES:
                self.batches.pop(next(iter(self.batches)))
        return {
            "ok": [{"old": o, "new": n} for o, n in ok],
            "failed": [{"path": p, "error": e} for p, e in failed],
            "batch_id": batch_id,
            "renamed": len(changed),
        }

    def undo(self, batch_id: str) -> dict:
        pairs = self.batches.get(batch_id)
        if not pairs:
            return {"restored": [], "failed": [], "ok": False}
        ok, failed = self._renamer.undo(pairs)
        if not failed:
            self.batches.pop(batch_id, None)
        else:  # keep only the ones still needing undo
            done = {src for src, _ in ok}  # src here is the new name
            self.batches[batch_id] = [(o, n) for o, n in pairs if n not in done]
        return {
            "restored": [{"new": src, "old": dst} for src, dst in ok],
            "failed": [{"path": p, "error": e} for p, e in failed],
            "ok": not failed,
        }
