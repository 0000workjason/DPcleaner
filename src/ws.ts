import { wsUrl } from "./api";
import type { Progress } from "./types";

/** Open the progress WebSocket. Calls onProgress for every frame; resolves the
 *  returned promise when the backend reaches a terminal phase. */
export function openProgress(onProgress: (p: Progress) => void): {
  close: () => void;
} {
  const ws = new WebSocket(wsUrl());
  ws.onmessage = (ev) => {
    try {
      onProgress(JSON.parse(ev.data) as Progress);
    } catch {
      /* ignore malformed frame */
    }
  };
  return { close: () => ws.close() };
}
