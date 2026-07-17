export interface BackendInfo {
  port: number;
  token: string;
}

export interface Member {
  path: string;
  name: string;
  folder: string;
  ext: string;
  width: number;
  height: number;
  size: number;
  ctime: number; // file creation time (epoch seconds)
}

export interface Group {
  id: string;
  members: Member[];
  sim_min: number;
  sim_max: number;
  total_size: number;
}

export interface Stats {
  groups: number;
  images: number;
}

export interface GroupsResponse {
  threshold: number;
  total_files: number;
  embedded: number;
  groups: Group[];
  stats: Stats;
}

export interface Progress {
  phase:
    | "idle"
    | "scanning"
    | "embedding"
    | "grouping"
    | "done"
    | "cancelled"
    | "error";
  done: number;
  total: number;
  status: string;
  error: string;
}

export interface ActionResult {
  ok: string[];
  failed: { path: string; error: string }[];
}

export interface UndoResult {
  restored: string[];
  failed: { path: string; error: string }[];
  remaining: number;
}

export interface RenamePlanItem {
  old: string;
  new: string;
}

export interface RenameArgs {
  folder: string;
  start?: number;
  pad?: number | null;
  prefix?: string;
  order?: "name" | "date" | "size";
}

export interface RenamePreview {
  items: RenamePlanItem[];
  count: number;
  conflicts: string[];
}

export interface RenameResult {
  ok: RenamePlanItem[];
  failed: { path: string; error: string }[];
  batch_id: string;
  renamed: number;
}

export interface RenameUndoResult {
  restored: { old: string; new: string }[];
  failed: { path: string; error: string }[];
  ok: boolean;
}
