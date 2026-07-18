"""Tiny JSON settings file in the user's home (remembers folders, etc.)."""

from __future__ import annotations

import json
import logging
import os

logger = logging.getLogger(__name__)

CONFIG_PATH = os.path.join(os.path.expanduser("~"), ".dpcleaner.json")


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
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception:
        logger.exception("failed to save settings to %s", CONFIG_PATH)
