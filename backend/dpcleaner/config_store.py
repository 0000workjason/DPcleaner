"""Tiny JSON settings file in the user's home (remembers folders, etc.)."""

from __future__ import annotations

import json
import os

CONFIG_PATH = os.path.join(os.path.expanduser("~"), ".dpcleaner.json")


def load_config() -> dict:
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(cfg: dict) -> None:
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception:
        pass
