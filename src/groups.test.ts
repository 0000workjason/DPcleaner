import { describe, expect, it } from "vitest";
import { filterGroups, groupNewest, sortGroups, sortMembers } from "./groups";
import type { Group } from "./types";

function member(over: Partial<Group["members"][number]> = {}) {
  return {
    path: "C:/pics/a.png",
    name: "a.png",
    folder: "C:/pics",
    ext: ".png",
    width: 100,
    height: 100,
    size: 1000,
    ctime: 0,
    mtime: 0,
    ...over,
  };
}

function makeGroup(over: Partial<Group> = {}): Group {
  return {
    id: "g1",
    members: [member()],
    sim_min: 0.9,
    sim_max: 0.99,
    total_size: 1000,
    ...over,
  };
}

describe("groupNewest", () => {
  it("returns the max ctime among a group's members", () => {
    const g = makeGroup({
      members: [
        member({ ctime: 5 }),
        member({ ctime: 42 }),
        member({ ctime: 1 }),
      ],
    });
    expect(groupNewest(g)).toBe(42);
  });

  it("returns 0 for a group with no members", () => {
    expect(groupNewest(makeGroup({ members: [] }))).toBe(0);
  });
});

describe("sortGroups", () => {
  it("sorts by ctime (newest first) when by is 'ctime'", () => {
    const old = makeGroup({ id: "old", members: [member({ ctime: 1 })] });
    const mid = makeGroup({ id: "mid", members: [member({ ctime: 5 })] });
    const newest = makeGroup({ id: "new", members: [member({ ctime: 9 })] });
    const sorted = sortGroups([old, newest, mid], "ctime");
    expect(sorted.map((g) => g.id)).toEqual(["new", "mid", "old"]);
  });

  it("sorts by similarity (highest sim_min first) by default", () => {
    const low = makeGroup({ id: "low", sim_min: 0.6 });
    const high = makeGroup({ id: "high", sim_min: 0.95 });
    const sorted = sortGroups([low, high], "sim");
    expect(sorted.map((g) => g.id)).toEqual(["high", "low"]);
  });

  // ctime and mtime deliberately disagree: each group's mtime rank is the
  // reverse of its ctime rank, so reading the wrong field cannot pass both.
  const clash = [
    makeGroup({ id: "a", members: [member({ ctime: 1, mtime: 9 })] }),
    makeGroup({ id: "b", members: [member({ ctime: 5, mtime: 5 })] }),
    makeGroup({ id: "c", members: [member({ ctime: 9, mtime: 1 })] }),
  ];

  it("sorts by mtime (newest first) when by is 'mtime'", () => {
    expect(sortGroups(clash, "mtime").map((g) => g.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(sortGroups(clash, "ctime").map((g) => g.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("does not mutate the original array", () => {
    const groups = [
      makeGroup({ id: "a", sim_min: 0.5 }),
      makeGroup({ id: "b", sim_min: 0.9 }),
    ];
    const original = [...groups];
    sortGroups(groups, "sim");
    expect(groups).toEqual(original);
  });
});

describe("sortMembers", () => {
  const g = makeGroup({
    members: [
      member({ path: "mid", ctime: 5, mtime: 5 }),
      member({ path: "old", ctime: 1, mtime: 9 }),
      member({ path: "new", ctime: 9, mtime: 1 }),
    ],
  });

  it("orders members newest first, by the requested clock", () => {
    expect(sortMembers(g, "ctime").map((m) => m.path)).toEqual([
      "new",
      "mid",
      "old",
    ]);
    expect(sortMembers(g, "mtime").map((m) => m.path)).toEqual([
      "old",
      "mid",
      "new",
    ]);
  });

  // There is no per-member similarity in the payload (only a range per group),
  // so "sim" has to fall back rather than leave tiles in backend order.
  it("falls back to ctime under the similarity sort", () => {
    expect(sortMembers(g, "sim").map((m) => m.path)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("does not mutate the group", () => {
    const before = g.members.map((m) => m.path);
    sortMembers(g, "mtime");
    expect(g.members.map((m) => m.path)).toEqual(before);
  });
});

describe("filterGroups", () => {
  const groups = [
    makeGroup({
      id: "big",
      members: [
        member({ path: "a.jpg", name: "sunset.jpg", ext: ".jpg" }),
        member({ path: "b.jpg", name: "beach.jpg", ext: ".jpg" }),
      ],
    }),
    makeGroup({
      id: "small",
      members: [member({ path: "c.png", name: "logo.png", ext: ".png" })],
    }),
  ];

  it("filters out groups smaller than minGroup", () => {
    const out = filterGroups(groups, { search: "", ext: "", minGroup: 2 });
    expect(out.map((g) => g.id)).toEqual(["big"]);
  });

  it("filters by extension", () => {
    const out = filterGroups(groups, { search: "", ext: ".png", minGroup: 1 });
    expect(out.map((g) => g.id)).toEqual(["small"]);
  });

  it("filters by filename search, case-insensitively", () => {
    const out = filterGroups(groups, {
      search: "SUNSET",
      ext: "",
      minGroup: 1,
    });
    expect(out.map((g) => g.id)).toEqual(["big"]);
  });

  it("combines all three filters", () => {
    const out = filterGroups(groups, {
      search: "logo",
      ext: ".png",
      minGroup: 1,
    });
    expect(out.map((g) => g.id)).toEqual(["small"]);
  });

  it("returns everything when filters are empty/permissive", () => {
    const out = filterGroups(groups, { search: "", ext: "", minGroup: 1 });
    expect(out.map((g) => g.id).sort()).toEqual(["big", "small"]);
  });
});
