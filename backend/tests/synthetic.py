"""Synthetic image fixtures for the engine tests.

Generates several "base" illustrations plus transformed variants (resize+JPEG
recompress, horizontal flip, hue recolour, crop) and a couple of unrelated
images. Used by tests/test_engine_parity.py to check that the real SSCD engine
clusters all variants of one artwork together.
"""

from __future__ import annotations

import os
import random
import shutil

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
TEST_DIR = os.path.join(HERE, "_selftest")


def _draw_base(theme: int, size: int = 768) -> Image.Image:
    """Make a *distinct*, texture-rich image per theme so different artworks are
    genuinely far apart in embedding space (a fair mechanics test)."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    rnd = random.Random(theme)

    if theme == 0:  # warm vertical stripes + sun
        r = 0.55 + 0.45 * np.sin(xx * 42)
        g = 0.35 + 0.30 * np.sin(xx * 42 + 1.0)
        b = 0.10 + 0.05 * yy
    elif theme == 1:  # cool diagonal weave
        d = xx + yy
        r = 0.10 + 0.10 * np.sin(d * 30)
        g = 0.20 + 0.20 * np.sin(d * 30 + 2.0)
        b = 0.60 + 0.35 * np.sin(d * 30)
    else:  # green concentric rings
        rad = np.sqrt((xx - 0.5) ** 2 + (yy - 0.5) ** 2)
        r = 0.20 + 0.18 * np.sin(rad * 44)
        g = 0.55 + 0.45 * np.sin(rad * 44)
        b = 0.10 + 0.10 * np.cos(rad * 44)

    arr = np.clip(np.stack([r, g, b], axis=-1) * 255, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr)

    # theme-specific "subject" shapes so structure differs too
    d = ImageDraw.Draw(img)
    for _ in range(8):
        x0, y0 = rnd.randint(0, size - 1), rnd.randint(0, size - 1)
        s = rnd.randint(60, 220)
        col = (rnd.randint(60, 255), rnd.randint(60, 255), rnd.randint(60, 255))
        if theme == 0:
            d.ellipse([x0, y0, x0 + s, y0 + s], fill=col, outline=(0, 0, 0), width=4)
        elif theme == 1:
            d.line([x0, y0, x0 + s, y0 + s // 2], fill=col, width=10)
        else:
            d.polygon([(x0, y0), (x0 + s, y0), (x0 + s // 2, y0 + s)], fill=col)
    return img


def _recolor(img: Image.Image, shift: int = 45) -> Image.Image:
    h, s, v = img.convert("HSV").split()
    h = h.point(lambda x: (x + shift) % 256)
    return Image.merge("HSV", (h, s, v)).convert("RGB")


def build_test_set() -> dict[str, list[str]]:
    if os.path.isdir(TEST_DIR):
        shutil.rmtree(TEST_DIR)
    os.makedirs(TEST_DIR)

    truth: dict[str, list[str]] = {}

    def save(img, name, **kw):
        p = os.path.join(TEST_DIR, name)
        img.save(p, **kw)
        return p

    # --- Artwork A: full variant battery (768px base) ---
    A = _draw_base(theme=0)
    truth["A"] = [
        save(A, "A_orig.png"),
        save(A.resize((460, 460)), "A_resize_jpg.jpg", quality=70),  # rescale + recompress
        save(A.transpose(Image.FLIP_LEFT_RIGHT), "A_flip.png"),  # mirror
        save(_recolor(A), "A_recolor.jpg", quality=85),  # colour edit
        save(A.crop((80, 80, 688, 688)), "A_crop.jpg", quality=80),  # crop
    ]

    # --- Artwork B: light variant ---
    B = _draw_base(theme=1)
    truth["B"] = [
        save(B, "B_orig.png"),
        save(B.resize((400, 400)), "B_small_jpg.jpg", quality=60),
    ]

    # --- Artwork C: unique, must stay alone ---
    C = _draw_base(theme=2)
    truth["C"] = [save(C, "C_unique.png")]

    return truth


if __name__ == "__main__":
    truth = build_test_set()
    print(f"Built test set in {TEST_DIR}")
    for k, v in truth.items():
        print(f"  {k}: {len(v)} file(s)")
