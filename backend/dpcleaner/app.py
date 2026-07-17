"""FastAPI routes for the dpcleaner desktop backend.

Thin HTTP/WebSocket layer: each route translates a request into a use-case call
(``container.dedupe`` / ``container.rename``) and presents the result via
``serializers``. Runs on 127.0.0.1 only and (in the packaged app) is guarded by a
random token the Tauri shell passes in; in dev the token is unset and the guard
is a no-op.
"""

from __future__ import annotations

import asyncio
import os

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel

from . import __version__
from .config_store import load_config, save_config
from .container import dedupe, rename
from .serializers import groups_to_dict, progress_to_dict
from . import thumbs

app = FastAPI(title="dpcleaner backend", version=__version__)

# Loopback-only service; allow any local origin (Vite dev server, tauri://...).
# Access is gated by the token guard below, not by origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_TOKEN: str | None = None
_OPEN_PATHS = {"/health"}


def configure_token(token: str | None) -> None:
    global _TOKEN
    _TOKEN = token


@app.middleware("http")
async def _token_guard(request: Request, call_next):
    if _TOKEN and request.method != "OPTIONS" and request.url.path not in _OPEN_PATHS:
        # Header for fetch() calls; query param for <img src> (can't set headers).
        supplied = request.headers.get("x-dpc-token") or request.query_params.get("token")
        if supplied != _TOKEN:
            return JSONResponse({"detail": "bad token"}, status_code=401)
    return await call_next(request)


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
            if p["phase"] in ("done", "cancelled", "error", "idle"):
                # one final frame already sent; stop pushing until next scan
                if p["phase"] != "idle":
                    break
            # Wait via receive() rather than plain sleep so an abrupt
            # disconnect (peer vanishes without a clean close, e.g. a crash)
            # is detected promptly -- send() alone doesn't reliably raise on
            # a connection the peer already dropped, which otherwise leaves
            # this loop spinning forever trying to send into the void.
            try:
                await asyncio.wait_for(ws.receive(), timeout=0.12)
            except asyncio.TimeoutError:
                pass
    except WebSocketDisconnect:
        pass
    except Exception:
        pass


# ---- groups / stats ----
@app.get("/groups")
def groups(threshold: float = 0.60):
    return groups_to_dict(*dedupe.grouped(threshold), threshold=threshold)


@app.get("/stats")
def stats(threshold: float = 0.60):
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
    return dict(start=req.start, pad=req.pad, prefix=req.prefix, order=req.order)


@app.post("/rename/preview")
def rename_preview(req: RenameReq):
    return rename.preview(req.folder, **_rename_args(req))


@app.post("/rename/apply")
def rename_apply(req: RenameReq):
    return rename.apply(req.folder, **_rename_args(req))


@app.post("/rename/undo")
def rename_undo(req: RenameUndoReq):
    return rename.undo(req.batch_id)


# ---- settings ----
@app.get("/settings")
def get_settings():
    return load_config()


@app.post("/settings")
def post_settings(req: SettingsReq):
    cfg = load_config()
    cfg.update(req.values)
    save_config(cfg)
    return {"ok": True, "config": cfg}
