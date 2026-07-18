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
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("127.0.0.1", int(os.environ.get("DPC_PORT", "0"))))
    s.listen()
    return s


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
    token = os.environ.get("DPC_TOKEN")
    if token is None and os.environ.get("DPC_DEV") != "1":
        token = secrets.token_urlsafe(16)
    configure_token(token)

    print(f"DPC_READY port={port} token={token or ''}", flush=True)

    config = uvicorn.Config(app, log_level="warning", access_log=False)
    server = uvicorn.Server(config)
    server.run(sockets=[sock])


if __name__ == "__main__":
    main()
