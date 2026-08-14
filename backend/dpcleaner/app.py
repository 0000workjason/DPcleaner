"""FastAPI routes for the dpcleaner desktop backend.

Thin HTTP/WebSocket layer: each route translates a request into a use-case call
(``container.dedupe`` / ``container.rename``) and presents the result via
``serializers``. Runs on 127.0.0.1 only and (in the packaged app) is guarded by a
random token the Tauri shell passes in; in dev the token is unset and the guard
is a no-op.
"""

from __future__ import annotations

import asyncio
import logging
import os
import secrets

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import __version__, thumbs
from .config_store import load_config, update_config
from .container import dedupe, rename
from .serializers import groups_to_dict, progress_to_dict

logger = logging.getLogger(__name__)

app = FastAPI(title="dpcleaner backend", version=__version__)

_TOKEN: str | None = None
_OPEN_PATHS = {"/health"}

# The webview's own origins. Loopback-only binding already keeps remote hosts
# out; this stops an arbitrary page in the user's browser from reading
# responses if it ever gets hold of the token.
_ALLOWED_ORIGINS = [
    "http://tauri.localhost",  # packaged app (Windows custom protocol)
    "https://tauri.localhost",
    "tauri://localhost",
    "http://localhost:1420",  # vite dev server
    "http://127.0.0.1:1420",
]


def configure_token(token: str | None) -> None:
    global _TOKEN
    _TOKEN = token


# NOTE: middleware order. Starlette runs the *last* registered middleware
# outermost, so CORSMiddleware is added after this guard -- otherwise the guard
# short-circuits first and a 401 carries no CORS headers, which the webview can
# only report as an opaque network error instead of "bad token".
@app.middleware("http")
async def _token_guard(request: Request, call_next):
    if _TOKEN and request.method != "OPTIONS" and request.url.path not in _OPEN_PATHS:
        # Header for fetch() calls; query param for <img src> (can't set headers).
        supplied = request.headers.get("x-dpc-token") or request.query_params.get("token")
        if not supplied or not secrets.compare_digest(supplied, _TOKEN):
            return JSONResponse({"detail": "bad token"}, status_code=401)
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- request models ----
class ScanReq(BaseModel):
    folders: list[str]
    device: str | None = None


class PathsReq(BaseModel):
    paths: list[str]


class SettingsReq(BaseModel):
    values: dict


class RenameReq(BaseModel):
    folder: str
    start: int = 1
    pad: int | None = None
    prefix: str = ""
    order: str = "name"  # name | date | size


class RenameUndoReq(BaseModel):
    batch_id: str


# ---- meta ----
@app.get("/health")
def health():
    return {"status": "ok", "version": __version__, "scanning": dedupe.is_scanning()}


# ---- scan / progress ----
@app.post("/scan")
def scan(req: ScanReq):
    folders = [f for f in req.folders if f and os.path.isdir(f)]
    if not folders:
        raise HTTPException(400, "no valid folders")
    try:
        dedupe.start_scan(folders, device=req.device)
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "folders": folders}


@app.post("/scan/cancel")
def scan_cancel():
    dedupe.cancel_scan()
    return {"ok": True}


@app.websocket("/ws")
async def ws_progress(ws: WebSocket):
    # Token check for the websocket (middleware above doesn't cover WS).
    if _TOKEN and ws.query_params.get("token") != _TOKEN:
        await ws.close(code=1008)
        return
    await ws.accept()
    try:
        while True:
            p = progress_to_dict(dedupe.progress)
            await ws.send_json(p)
            if p["phase"] in ("done", "cancelled", "error"):
                # one final frame already sent; stop pushing until next scan
                break
            # Wait via receive() rather than plain sleep so an abrupt
            # disconnect (peer vanishes without a clean close, e.g. a crash)
            # is detected promptly -- send() alone doesn't reliably raise on
            # a connection the peer already dropped, which otherwise leaves
            # this loop spinning forever trying to send into the void.
            # NOTE: ws.receive() does NOT raise on disconnect -- it returns the
            # disconnect message and only the typed receive_*() helpers raise.
            # Checking the message type keeps a normal client close (every time
            # the Scanning screen unmounts) out of the error log.
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=0.12)
            except asyncio.TimeoutError:
                continue
            if msg.get("type") == "websocket.disconnect":
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("ws_progress crashed")


# ---- groups / stats ----
def _clamp_threshold(t: float) -> float:
    """Cosine similarity is in [0, 1]. The lower triangle of the score matrix is
    masked with -1.0, so a threshold at or below that matches every one of the
    n^2 pairs and the grouping loop syncs the GPU once per pair -- hours of
    hang and an OOM. Clamp rather than trust the query string."""
    return max(0.0, min(1.0, t))


@app.get("/groups")
def groups(threshold: float = 0.60):
    threshold = _clamp_threshold(threshold)
    return groups_to_dict(*dedupe.grouped(threshold), threshold=threshold)


@app.get("/stats")
def stats(threshold: float = 0.60):
    threshold = _clamp_threshold(threshold)
    return groups_to_dict(*dedupe.grouped(threshold), threshold=threshold)["stats"]


# ---- images ----
@app.get("/thumb")
def thumb(path: str, size: int = 320):
    data = thumbs.get_thumb(path, maxdim=size)
    if data is None:
        raise HTTPException(404, "cannot render")
    return Response(
        content=data, media_type="image/jpeg", headers={"Cache-Control": "max-age=86400"}
    )


@app.get("/image")
def image(path: str, size: int = 2048):
    data = thumbs.get_preview(path, maxdim=size)
    if data is None:
        raise HTTPException(404, "cannot render")
    return Response(content=data, media_type="image/jpeg")


# ---- destructive actions ----
@app.post("/trash")
def trash(req: PathsReq):
    return dedupe.trash(req.paths)


@app.post("/undo")
def undo():
    return dedupe.undo()


# ---- folder rename (numeric sequence) ----
def _rename_args(req: RenameReq) -> dict:
    if not req.folder or not os.path.isdir(req.folder):
        raise HTTPException(400, "folder not found")
    return {"start": req.start, "pad": req.pad, "prefix": req.prefix, "order": req.order}


@app.post("/rename/preview")
def rename_preview(req: RenameReq):
    try:
        return rename.preview(req.folder, **_rename_args(req))
    except ValueError as e:  # rejected prefix / target outside the folder
        raise HTTPException(400, str(e))


@app.post("/rename/apply")
def rename_apply(req: RenameReq):
    try:
        return rename.apply(req.folder, **_rename_args(req))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/rename/undo")
def rename_undo(req: RenameUndoReq):
    return rename.undo(req.batch_id)


# ---- settings ----
@app.get("/settings")
def get_settings():
    return load_config()


@app.post("/settings")
def post_settings(req: SettingsReq):
    try:
        cfg = update_config(req.values)
    except Exception as e:  # noqa: BLE001 - never report an unsaved setting as saved
        raise HTTPException(500, f"could not save settings: {e}")
    return {"ok": True, "config": cfg}
