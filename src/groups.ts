/** Pure group view-logic: sorting and filtering the results gallery.
 *  No React, no I/O — just transforms over domain types, so it's unit-testable. */
import type { Group } from "./types";

/** Latest creation time among a group's members (newest photo in the cluster). */
export function groupNewest(g: Group): number {
  return g.members.reduce((mx, m) => Math.max(mx, m.ctime), 0);
}

export function sortGroups(groups: Group[], by: string): Group[] {
  const g = [...groups];
  switch (by) {
    // by the most-recently-created photo in each group, newest first
    case "ctime":
      return g.sort((a, b) => groupNewest(b) - groupNewest(a));
    // similarity, most-similar groups first
    default:
      return g.sort((a, b) => b.sim_min - a.sim_min);
  }
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
