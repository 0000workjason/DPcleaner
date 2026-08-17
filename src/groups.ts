/** Pure group view-logic: sorting and filtering the results gallery.
 *  No React, no I/O — just transforms over domain types, so it's unit-testable. */
import type { Group, Member } from "./types";

/** Which per-member timestamp a sort mode reads. "sim" has no per-member value
 *  (the data only carries a similarity range per group), so it falls back to
 *  creation time rather than leaving tiles in arbitrary backend order. */
function timeKey(by: string): "ctime" | "mtime" {
  return by === "mtime" ? "mtime" : "ctime";
}

/** Latest timestamp among a group's members (newest photo in the cluster). */
export function groupNewest(g: Group, by = "ctime"): number {
  const k = timeKey(by);
  return g.members.reduce((mx, m) => Math.max(mx, m[k]), 0);
}

/** A group's members, newest first. Also drives the compare viewer's order. */
export function sortMembers(g: Group, by: string): Member[] {
  const k = timeKey(by);
  return [...g.members].sort((a, b) => b[k] - a[k]);
}

export function sortGroups(groups: Group[], by: string): Group[] {
  const g = [...groups];
  // similarity, most-similar groups first
  if (by === "sim") return g.sort((a, b) => b.sim_min - a.sim_min);
  // otherwise by the most-recently created/modified photo in each group
  return g.sort((a, b) => groupNewest(b, by) - groupNewest(a, by));
}

export interface GroupFilter {
  search: string;
  ext: string; // "" = all
  minGroup: number; // minimum members in a group
}

/** Apply the toolbar filters (min group size, extension, filename search). */
export function filterGroups(groups: Group[], f: GroupFilter): Group[] {
  const q = f.search.trim().toLowerCase();
  let gs = groups.filter((g) => g.members.length >= f.minGroup);
  if (f.ext) gs = gs.filter((g) => g.members.some((m) => m.ext === f.ext));
  if (q)
    gs = gs.filter((g) =>
      g.members.some((m) => m.name.toLowerCase().includes(q)),
    );
  return gs;
}
