import { wsUrl } from "./api";
import type { Progress } from "./types";

/** Open the progress WebSocket.
 *
 *  Calls `onProgress` for every frame, and `onLost` if the socket closes
 *  without having delivered a terminal phase. That callback matters: a
 *  terminal frame is the only thing that moves the app off the Scanning
 *  screen, so a socket that dies mid-scan (backend crash, machine sleep) used
 *  to leave the UI frozen at the last percentage with no way back. */
export function openProgress(
  onProgress: (p: Progress) => void,
  onLost?: () => void,
): { close: () => void } {
  const ws = new WebSocket(wsUrl());
  let done = false; // a terminal frame arrived: closing afterwards is expected
  let closedByUs = false;

  ws.onmessage = (ev) => {
    try {
      const p = JSON.parse(ev.data) as Progress;
      if (p.phase === "done" || p.phase === "cancelled" || p.phase === "error")
        done = true;
      onProgress(p);
    } catch {
      /* ignore malformed frame */
    }
  };
  const lost = () => {
    if (done || closedByUs) return;
    done = true; // onerror is usually followed by onclose; report once
    onLost?.();
  };
  ws.onclose = lost;
  ws.onerror = lost;

  return {
    close: () => {
      closedByUs = true;
      ws.close();
    },
  };
}
