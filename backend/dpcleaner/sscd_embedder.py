"""Image embeddings via Meta's SSCD copy-detection model.

SSCD is a self-supervised *copy-detection* model, trained to tell whether one
image is a copy/edited version of another. So re-saved / rescaled / recompressed
/ cropped / recoloured / mirrored versions of the same artwork land very close,
while merely same-character art stays far apart — exactly what we want for
Pixiv/Twitter dedupe.

Each image is embedded twice (itself + horizontal mirror) so flipped re-posts
are caught. Embeddings are L2-normalised, so cosine similarity is a plain dot
product downstream.

Implements the ``interfaces.embedder.Embedder`` port.
"""

from __future__ import annotations

import os
import io
import hashlib

import numpy as np
from PIL import Image, ImageOps, ImageFile

import torch

ImageFile.LOAD_TRUNCATED_IMAGES = True

SSCD_MODEL = "sscd_disc_mixup"
SSCD_URL = "https://dl.fbaipublicfiles.com/sscd-copy-detection/sscd_disc_mixup.torchscript.pt"
SSCD_PATH = os.path.join(
    os.path.expanduser("~"), ".cache", "sscd", "sscd_disc_mixup.torchscript.pt"
)
# SHA-256 of the known-good TorchScript build. The model is executable code, so
# we refuse to load any file whose hash doesn't match (guards against a tampered
# CDN copy or a corrupt/partial download). Set to "" to skip the check.
SSCD_SHA256 = "9f26bd4c848cc19b73d2ae92eea6e04886f61a7b764ceb7a13aeee62e6a6db56"

DEFAULT_MODEL = SSCD_MODEL


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _load_rgb(path: str) -> Image.Image:
    img = Image.open(path)
    if getattr(img, "is_animated", False):
        img.seek(0)
    return img.convert("RGB")


class SSCDEmbedder:
    """Meta SSCD copy-detection embeddings (TorchScript), batched, image + flip."""

    def __init__(
        self,
        device=None,
        batch_size=48,
        use_fp16=True,
        model_path=SSCD_PATH,
        url=SSCD_URL,
        sha256=SSCD_SHA256,
    ):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.batch_size = max(2, batch_size)
        self.use_fp16 = use_fp16 and self.device == "cuda"

        from torchvision import transforms

        if not os.path.exists(model_path):
            os.makedirs(os.path.dirname(model_path), exist_ok=True)
            torch.hub.download_url_to_file(url, model_path)
        # Integrity check: re-fetch once on mismatch (handles a corrupt/partial
        # download), then fail closed rather than load a possibly-tampered model.
        if sha256 and _sha256(model_path) != sha256:
            torch.hub.download_url_to_file(url, model_path)
            got = _sha256(model_path)
            if got != sha256:
                raise RuntimeError(
                    f"SSCD model hash mismatch at {model_path}\n"
                    f"  expected {sha256}\n"
                    f"  got      {got}\n"
                    "Refusing to load a possibly-tampered model. Delete the file "
                    "and retry, or update SSCD_SHA256 if you changed it on purpose."
                )
        # Load via buffer: torch.jit's C++ fopen can't handle non-ASCII (CJK)
        # characters in the path on Windows.
        with open(model_path, "rb") as f:
            buf = io.BytesIO(f.read())
        self.model = torch.jit.load(buf).to(self.device).eval()

        self.transform = transforms.Compose(
            [
                transforms.Resize([320, 320]),
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ]
        )
        self.dim = 512

    @torch.inference_mode()
    def embed_paths(self, scanned, progress_cb=None) -> dict:
        results: dict[str, list] = {}
        dims: dict[str, tuple[int, int]] = {}
        tensors: list[torch.Tensor] = []
        owners: list[tuple[str, bool]] = []
        total = len(scanned)
        done = 0

        def flush():
            if not tensors:
                return
            x = torch.stack(tensors).to(self.device, non_blocking=True)
            if self.use_fp16:
                with torch.autocast("cuda", dtype=torch.float16):
                    feats = self.model(x)
            else:
                feats = self.model(x)
            feats = torch.nn.functional.normalize(feats.float(), dim=1).cpu().numpy()
            for vec, (path, is_flip) in zip(feats, owners):
                slot = results.setdefault(path, [None, None])
                slot[1 if is_flip else 0] = vec.astype(np.float32)
            tensors.clear()
            owners.clear()

        for sf in scanned:
            try:
                img = _load_rgb(sf.path)
                dims[sf.path] = img.size
                t_normal = self.transform(img)
                t_flip = self.transform(ImageOps.mirror(img))
            except Exception:
                done += 1
                if progress_cb:
                    progress_cb(done, total)
                continue

            tensors.append(t_normal)
            owners.append((sf.path, False))
            tensors.append(t_flip)
            owners.append((sf.path, True))
            if len(tensors) >= self.batch_size:
                flush()
            done += 1
            if progress_cb:
                progress_cb(done, total)

        flush()

        final: dict[str, tuple] = {}
        for path, (emb, emb_flip) in results.items():
            if emb is None or emb_flip is None:
                continue
            w, h = dims.get(path, (0, 0))
            final[path] = (w, h, emb, emb_flip)
        return final


def make_embedder(device=None) -> SSCDEmbedder:
    return SSCDEmbedder(device=device)
