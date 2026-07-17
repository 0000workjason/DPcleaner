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
    if (got) {
      info = got;
      return got;
    }
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
): string {
  const t = info?.token ? `&token=${encodeURIComponent(info.token)}` : "";
  return `${base()}/${kind}?path=${encodeURIComponent(path)}&size=${size}${t}`;
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
