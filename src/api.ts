import { invoke } from "@tauri-apps/api/core";
import type {
  ActionResult,
  BackendInfo,
  GroupsResponse,
  Stats,
  UndoResult,
  RenameArgs,
  RenamePreview,
  RenameResult,
  RenameUndoResult,
} from "./types";

let info: BackendInfo | null = null;

/** Poll the Rust side until the Python sidecar has reported its port + token. */
export async function waitForBackend(
  timeoutMs = 120_000,
): Promise<BackendInfo> {
  const start = Date.now();
  for (;;) {
    const got = await invoke<BackendInfo | null>("backend_info").catch(
      () => null,
    );
    // Guard the port: a malformed handshake used to yield port 0, which gets
    // cached here and makes every later call fail against http://127.0.0.1:0.
    if (got && got.port) {
      info = got;
      return got;
    }
    // The Rust side records a hard failure here. Without this we cannot tell
    // "not ready yet" from "never coming", and a failure known in 200ms spun
    // the splash for the full two minutes.
    const failed = await invoke<string | null>("backend_error").catch(
      () => null,
    );
    if (failed) throw new Error(failed);
    if (Date.now() - start > timeoutMs)
      throw new Error("engine start timed out");
    await new Promise((r) => setTimeout(r, 250));
  }
}

function base(): string {
  if (!info) throw new Error("backend not ready");
  return `http://127.0.0.1:${info.port}`;
}

function authHeaders(): Record<string, string> {
  return info?.token ? { "x-dpc-token": info.token } : {};
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base() + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** URL for an <img> tag (token rides as a query param since img can't set headers). */
export function imgUrl(
  path: string,
  size = 320,
  kind: "thumb" | "image" = "thumb",
  version?: string | number,
): string {
  const t = info?.token ? `&token=${encodeURIComponent(info.token)}` : "";
  // Cache buster. /thumb is served with max-age=86400 and the webview caches by
  // URL alone, so after a rename the same path can hold a different image and
  // the tile would show the old one -- while Compare (/image, uncached) shows
  // the new one, which is how you delete the wrong file.
  const v =
    version === undefined ? "" : `&v=${encodeURIComponent(String(version))}`;
  return `${base()}/${kind}?path=${encodeURIComponent(path)}&size=${size}${t}${v}`;
}

export function wsUrl(): string {
  const t = info?.token ? `?token=${encodeURIComponent(info.token)}` : "";
  return `ws://127.0.0.1:${info!.port}/ws${t}`;
}

export const api = {
  scan: (folders: string[], device?: string) =>
    req<{ ok: boolean; folders: string[] }>("/scan", {
      method: "POST",
      body: JSON.stringify({ folders, device: device ?? null }),
    }),
  cancelScan: () => req<{ ok: boolean }>("/scan/cancel", { method: "POST" }),
  groups: (threshold: number) =>
    req<GroupsResponse>(`/groups?threshold=${threshold}`),
  stats: (threshold: number) => req<Stats>(`/stats?threshold=${threshold}`),
  trash: (paths: string[]) =>
    req<ActionResult>("/trash", {
      method: "POST",
      body: JSON.stringify({ paths }),
    }),
  undo: () => req<UndoResult>("/undo", { method: "POST" }),
  renamePreview: (args: RenameArgs) =>
    req<RenamePreview>("/rename/preview", {
      method: "POST",
      body: JSON.stringify(args),
    }),
  renameApply: (args: RenameArgs) =>
    req<RenameResult>("/rename/apply", {
      method: "POST",
      body: JSON.stringify(args),
    }),
  renameUndo: (batch_id: string) =>
    req<RenameUndoResult>("/rename/undo", {
      method: "POST",
      body: JSON.stringify({ batch_id }),
    }),
  getSettings: () => req<Record<string, unknown>>("/settings"),
  saveSettings: (values: Record<string, unknown>) =>
    req<{ ok: boolean; config: Record<string, unknown> }>("/settings", {
      method: "POST",
      body: JSON.stringify({ values }),
    }),
};
