"""Tiny JSON settings file in the user's home (remembers folders, etc.)."""

from __future__ import annotations

import json
import logging
import os
import threading

from .paths import data_path

logger = logging.getLogger(__name__)

CONFIG_PATH = data_path(".dpcleaner.json")

# Settings POSTs are read-modify-write and FastAPI runs sync routes in a
# threadpool, so two concurrent saves would otherwise interleave and drop keys.
_LOCK = threading.Lock()


def load_config() -> dict:
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}  # normal on first run, nothing saved yet
    except Exception:
        logger.exception("failed to load settings from %s", CONFIG_PATH)
        return {}


def save_config(cfg: dict) -> None:
    """Write the settings file atomically.

    Writing in place would truncate first, so a crash -- or a concurrent
    ``load_config`` -- during the write leaves invalid JSON, which
    ``load_config`` then reports as an empty config, and the next save
    persists that emptiness over the user's remembered folder list.

    Raises on failure instead of swallowing, so the caller can tell the user
    the save didn't happen rather than showing it as saved.
    """
    tmp = f"{CONFIG_PATH}.{os.getpid()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        os.replace(tmp, CONFIG_PATH)  # atomic on Windows and POSIX
    except Exception:
        logger.exception("failed to save settings to %s", CONFIG_PATH)
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def update_config(values: dict) -> dict:
    """Merge ``values`` into the stored config and persist it, under a lock."""
    with _LOCK:
        cfg = load_config()
        cfg.update(values)
        save_config(cfg)
        return cfg
