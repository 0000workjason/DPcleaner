"""Entry point for the Python backend sidecar.

Binds a socket on 127.0.0.1 with an OS-chosen free port, prints a single
handshake line the Tauri (Rust) parent reads to learn the port + auth token:

    DPC_READY port=<int> token=<str>

then serves the FastAPI app on that socket. Run standalone for dev, or bundled
by PyInstaller as the Tauri externalBin.
"""

from __future__ import annotations

import logging
import os
import secrets
import socket

import uvicorn

from dpcleaner.app import app, configure_token


def _bind_loopback() -> socket.socket:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    # Deliberately NOT SO_REUSEADDR: on Windows that flag means "bind even if
    # another socket already holds this port", so it would let any local
    # process hijack ours -- and the ?token= the frontend puts in image and
    # WebSocket URLs. SO_EXCLUSIVEADDRUSE is the documented opposite. There is
    # nothing to reuse anyway; the OS picks a free ephemeral port.
    if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
        s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    s.bind(("127.0.0.1", int(os.environ.get("DPC_PORT", "0"))))
    s.listen()
    return s


def resolve_token() -> str | None:
    """The auth token for this run: honour one injected by the parent, else mint.

    ``not token`` rather than ``token is None``: an empty DPC_TOKEN would
    otherwise skip minting and leave ``_TOKEN = ""``, which the guard treats as
    falsy -- every endpoint open, including POST /trash, while the handshake
    still advertises a token= field. Returns None only in dev mode, where the
    guard is deliberately a no-op.
    """
    token = os.environ.get("DPC_TOKEN")
    if not token and os.environ.get("DPC_DEV") != "1":
        token = secrets.token_urlsafe(16)
    return token


def main() -> None:
    # Root logger config so every dpcleaner.* logger's output lands on stderr
    # (which the Tauri shell captures to dpcleaner-backend.log) with a
    # timestamp instead of being silently dropped.
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    sock = _bind_loopback()
    port = sock.getsockname()[1]
    # Token: honour one injected by the parent, else mint our own.
    token = resolve_token()
    configure_token(token)

    print(f"DPC_READY port={port} token={token or ''}", flush=True)

    config = uvicorn.Config(app, log_level="warning", access_log=False)
    server = uvicorn.Server(config)
    server.run(sockets=[sock])


if __name__ == "__main__":
    main()
