"""Where the backend keeps its data (settings, model cache, embedding cache).

Normally that's the user's home directory. In the portable build there must be
no trace left on the host machine, so the Tauri shell points ``DPC_DATA_DIR`` at
a folder next to the executable and everything follows it.

Resolved once at import: the shell sets the variable before spawning us, and a
mid-run change would leave half the paths pointing somewhere else.
"""

from __future__ import annotations

import os

#: Base directory for everything this app persists.
DATA_DIR = os.path.abspath(os.environ.get("DPC_DATA_DIR") or os.path.expanduser("~"))


def data_path(*parts: str) -> str:
    """Path to one of our data files, under :data:`DATA_DIR`."""
    return os.path.join(DATA_DIR, *parts)
