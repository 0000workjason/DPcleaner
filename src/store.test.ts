import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupsResponse } from "./types";

vi.mock("./api", () => ({
  waitForBackend: vi.fn(),
  api: {
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    scan: vi.fn(),
    cancelScan: vi.fn(),
    groups: vi.fn(),
    trash: vi.fn(),
    undo: vi.fn(),
  },
}));

import { api, waitForBackend } from "./api";
import { useStore } from "./store";

const initialState = useStore.getState();

function group(id: string, paths: string[]): GroupsResponse["groups"][number] {
  return {
    id,
    members: paths.map((path) => ({
      path,
      name: path.split("/").pop() ?? path,
      folder: "",
      ext: ".png",
      width: 100,
      height: 100,
      size: 1000,
      ctime: 0,
    })),
    sim_min: 0.9,
    sim_max: 0.99,
    total_size: paths.length * 1000,
  };
}

function groupsResponse(groups: GroupsResponse["groups"]): GroupsResponse {
  const images = groups.reduce((n, g) => n + g.members.length, 0);
  return {
    threshold: 0.6,
    total_files: images,
    embedded: images,
    groups,
    stats: { groups: groups.length, images },
  };
}

beforeEach(() => {
  useStore.setState(initialState, true);
  vi.clearAllMocks();
});

describe("selection", () => {
  it("toggleSelect adds then removes a path", () => {
    useStore.getState().toggleSelect("a.png");
    expect(useStore.getState().selection.has("a.png")).toBe(true);
    useStore.getState().toggleSelect("a.png");
    expect(useStore.getState().selection.has("a.png")).toBe(false);
  });

  it("selectAll selects every member of the visible groups", () => {
    useStore.setState({
      data: groupsResponse([
        group("g1", ["a.png", "b.png"]),
        group("g2", ["c.png", "d.png"]),
      ]),
    });
    useStore.getState().selectAll();
    expect([...useStore.getState().selection].sort()).toEqual([
      "a.png",
      "b.png",
      "c.png",
      "d.png",
    ]);
  });

  // Regression: selectAll used to walk the raw response while the gallery
  // rendered the filtered list, so Select all + Trash deleted files the user
  // could not see.
  it("selectAll skips groups hidden by the search filter", () => {
    useStore.setState({
      data: groupsResponse([
        group("g1", ["holiday-1.png", "holiday-2.png"]),
        group("g2", ["work-1.png", "work-2.png"]),
      ]),
      view: { ...initialState.view, search: "holiday" },
    });
    useStore.getState().selectAll();
    expect([...useStore.getState().selection].sort()).toEqual([
      "holiday-1.png",
      "holiday-2.png",
    ]);
  });

  it("selectAll skips groups hidden by the minGroup filter", () => {
    useStore.setState({
      data: groupsResponse([
        group("g1", ["a.png", "b.png"]),
        group("g2", ["c.png", "d.png", "e.png"]),
      ]),
      view: { ...initialState.view, minGroup: 3 },
    });
    useStore.getState().selectAll();
    expect([...useStore.getState().selection].sort()).toEqual([
      "c.png",
      "d.png",
      "e.png",
    ]);
  });

  it("selectAll is a no-op when there is no data yet", () => {
    useStore.getState().selectAll();
    expect(useStore.getState().selection.size).toBe(0);
  });

  it("selectPaths can select and deselect a batch", () => {
    useStore.getState().selectPaths(["a.png", "b.png"], true);
    expect([...useStore.getState().selection].sort()).toEqual([
      "a.png",
      "b.png",
    ]);
    useStore.getState().selectPaths(["a.png"], false);
    expect([...useStore.getState().selection]).toEqual(["b.png"]);
  });

  it("clearSelection empties the selection", () => {
    useStore.setState({ selection: new Set(["a.png"]) });
    useStore.getState().clearSelection();
    expect(useStore.getState().selection.size).toBe(0);
  });
});

describe("startScan", () => {
  it("refuses to scan with no folders and leaves the screen alone", async () => {
    await useStore.getState().startScan();
    expect(useStore.getState().toast).toContain("folder");
    expect(api.scan).not.toHaveBeenCalled();
  });

  it("starts a scan and resets data/selection when folders are present", async () => {
    vi.mocked(api.scan).mockResolvedValue({ ok: true, folders: ["C:/pics"] });
    useStore.setState({
      folders: ["C:/pics"],
      data: groupsResponse([group("g1", ["a.png"])]),
      selection: new Set(["a.png"]),
    });
    await useStore.getState().startScan();
    expect(useStore.getState().screen).toBe("scanning");
    expect(useStore.getState().data).toBeNull();
    expect(useStore.getState().selection.size).toBe(0);
    expect(api.scan).toHaveBeenCalledWith(["C:/pics"], undefined);
  });

  it("shows a toast and returns to folders when the scan fails to start", async () => {
    vi.mocked(api.scan).mockRejectedValue(new Error("boom"));
    useStore.setState({ folders: ["C:/pics"] });
    await useStore.getState().startScan();
    expect(useStore.getState().screen).toBe("folders");
    expect(useStore.getState().toast).toContain("boom");
  });

  // Regression: a 409 used to bounce the user back to Folders while the
  // already-running scan kept going with nobody listening for its results.
  it("stays on the scanning screen when a scan is already running", async () => {
    vi.mocked(api.scan).mockRejectedValue(
      new Error("/scan → 409 scan already running"),
    );
    useStore.setState({ folders: ["C:/pics"] });
    await useStore.getState().startScan();
    expect(useStore.getState().screen).toBe("scanning");
  });
});

describe("setProgress", () => {
  it("moves to results once the scan is done", async () => {
    vi.mocked(api.groups).mockResolvedValue(groupsResponse([]));
    useStore
      .getState()
      .setProgress({ phase: "done", done: 1, total: 1, status: "", error: "" });
    await vi.waitFor(() => expect(useStore.getState().screen).toBe("results"));
    expect(api.groups).toHaveBeenCalled();
  });

  it("shows a toast and returns to folders on error", () => {
    useStore.getState().setProgress({
      phase: "error",
      done: 0,
      total: 0,
      status: "",
      error: "disk full",
    });
    expect(useStore.getState().screen).toBe("folders");
    expect(useStore.getState().toast).toContain("disk full");
  });

  it("returns to folders when cancelled", () => {
    useStore.setState({ screen: "scanning" });
    useStore.getState().setProgress({
      phase: "cancelled",
      done: 0,
      total: 0,
      status: "",
      error: "",
    });
    expect(useStore.getState().screen).toBe("folders");
  });

  // Regression: the backend closes the socket after the terminal frame, so an
  // unhandled /groups rejection stranded the user at 100% forever.
  it("returns to folders when loading results fails after a scan", async () => {
    vi.mocked(api.groups).mockRejectedValue(new Error("boom"));
    useStore.setState({ screen: "scanning" });
    useStore
      .getState()
      .setProgress({ phase: "done", done: 1, total: 1, status: "", error: "" });
    await vi.waitFor(() => expect(useStore.getState().screen).toBe("folders"));
    expect(useStore.getState().toast).toContain("boom");
  });
});

describe("progressLost", () => {
  it("leaves the scanning screen when the progress socket dies", () => {
    useStore.setState({ screen: "scanning" });
    useStore.getState().progressLost();
    expect(useStore.getState().screen).toBe("folders");
    expect(useStore.getState().toast).toBeTruthy();
  });

  it("is a no-op when not scanning", () => {
    useStore.setState({ screen: "results" });
    useStore.getState().progressLost();
    expect(useStore.getState().screen).toBe("results");
  });
});

describe("refreshGroups", () => {
  it("drops selected paths that no longer exist in the new results", async () => {
    vi.mocked(api.groups).mockResolvedValue(
      groupsResponse([group("g1", ["a.png"])]),
    );
    useStore.setState({ selection: new Set(["a.png", "gone.png"]) });
    await useStore.getState().refreshGroups();
    expect([...useStore.getState().selection]).toEqual(["a.png"]);
  });

  // Regression: dragging the threshold down then up fired a slow request then
  // a fast one; the slow reply landed last and overwrote the fresh results.
  it("ignores a slow earlier response that lands after a newer one", async () => {
    let resolveSlow!: (v: GroupsResponse) => void;
    const slow = new Promise<GroupsResponse>((r) => {
      resolveSlow = r;
    });
    vi.mocked(api.groups)
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce(groupsResponse([group("fresh", ["new.png"])]));

    const stale = useStore.getState().refreshGroups();
    await useStore.getState().refreshGroups();
    expect(useStore.getState().data?.groups[0].id).toBe("fresh");

    resolveSlow(groupsResponse([group("stale", ["old.png"])]));
    await stale;
    expect(useStore.getState().data?.groups[0].id).toBe("fresh");
  });
});

describe("trash / undo", () => {
  it("trashPaths is a no-op for an empty list", async () => {
    await useStore.getState().trashPaths([]);
    expect(api.trash).not.toHaveBeenCalled();
  });

  it("trashPaths trashes, refreshes groups, and bumps undoCount on success", async () => {
    vi.mocked(api.trash).mockResolvedValue({ ok: ["a.png"], failed: [] });
    vi.mocked(api.groups).mockResolvedValue(groupsResponse([]));
    await useStore.getState().trashPaths(["a.png"]);
    expect(useStore.getState().undoCount).toBe(1);
    expect(useStore.getState().busy).toBe(false);
    expect(api.groups).toHaveBeenCalled();
  });

  it("trashPaths surfaces a toast for partial failures and does not bump undoCount", async () => {
    vi.mocked(api.trash).mockResolvedValue({
      ok: [],
      failed: [{ path: "a.png", error: "locked" }],
    });
    vi.mocked(api.groups).mockResolvedValue(groupsResponse([]));
    await useStore.getState().trashPaths(["a.png"]);
    expect(useStore.getState().undoCount).toBe(0);
    expect(useStore.getState().toast).toContain("1");
  });

  // Regression: trashPaths had no catch, so a rejected request un-greyed the
  // button with no message at all and the user just clicked it again.
  it("trashPaths surfaces a toast when the request itself fails", async () => {
    vi.mocked(api.trash).mockRejectedValue(new Error("connection reset"));
    await useStore.getState().trashPaths(["a.png"]);
    expect(useStore.getState().toast).toContain("connection reset");
    expect(useStore.getState().busy).toBe(false);
  });

  it("undo surfaces a toast when the request fails", async () => {
    vi.mocked(api.undo).mockRejectedValue(new Error("bin unavailable"));
    await useStore.getState().undo();
    expect(useStore.getState().toast).toContain("bin unavailable");
    expect(useStore.getState().busy).toBe(false);
  });

  it("trashSelected trashes the current selection and clears it", async () => {
    vi.mocked(api.trash).mockResolvedValue({
      ok: ["a.png", "b.png"],
      failed: [],
    });
    vi.mocked(api.groups).mockResolvedValue(groupsResponse([]));
    useStore.setState({ selection: new Set(["a.png", "b.png"]) });
    await useStore.getState().trashSelected();
    expect(api.trash).toHaveBeenCalledWith(["a.png", "b.png"]);
    expect(useStore.getState().selection.size).toBe(0);
  });

  it("undo restores files and updates the remaining undo count", async () => {
    vi.mocked(api.undo).mockResolvedValue({
      restored: ["a.png"],
      failed: [],
      remaining: 2,
    });
    vi.mocked(api.groups).mockResolvedValue(groupsResponse([]));
    await useStore.getState().undo();
    expect(useStore.getState().undoCount).toBe(2);
    expect(useStore.getState().busy).toBe(false);
  });
});

describe("view / ui state setters", () => {
  it("setView merges partial updates", () => {
    useStore.getState().setView({ search: "cat" });
    expect(useStore.getState().view.search).toBe("cat");
    expect(useStore.getState().view.sortBy).toBe(initialState.view.sortBy);
  });

  // Regression: a selection made under a wider filter used to survive into a
  // narrower one and get trashed while invisible.
  it("setView drops selected paths the new filter hides", () => {
    useStore.setState({
      data: groupsResponse([
        group("g1", ["holiday-1.png", "holiday-2.png"]),
        group("g2", ["work-1.png", "work-2.png"]),
      ]),
      selection: new Set(["holiday-1.png", "work-1.png"]),
    });
    useStore.getState().setView({ search: "work" });
    expect([...useStore.getState().selection]).toEqual(["work-1.png"]);
  });

  it("openCompare / closeCompare", () => {
    useStore.getState().openCompare(["a.png"]);
    expect(useStore.getState().compare).toEqual(["a.png"]);
    useStore.getState().closeCompare();
    expect(useStore.getState().compare).toBeNull();
  });

  it("openRename / closeRename", () => {
    useStore.getState().openRename("C:/pics");
    expect(useStore.getState().renameTarget).toBe("C:/pics");
    useStore.getState().closeRename();
    expect(useStore.getState().renameTarget).toBeNull();
  });

  it("setToast", () => {
    useStore.getState().setToast("hi");
    expect(useStore.getState().toast).toBe("hi");
  });

  it("setLang updates the language and persists it", () => {
    vi.mocked(api.saveSettings).mockResolvedValue({ ok: true, config: {} });
    useStore.getState().setLang("en");
    expect(useStore.getState().lang).toBe("en");
    expect(api.saveSettings).toHaveBeenCalledWith({ lang: "en" });
  });
});

describe("folders", () => {
  it("addFolders adds unique paths and persists them", () => {
    vi.mocked(api.saveSettings).mockResolvedValue({ ok: true, config: {} });
    useStore.getState().addFolders(["C:/a", "C:/b"]);
    useStore.getState().addFolders(["C:/a", "C:/c"]);
    expect(useStore.getState().folders).toEqual(["C:/a", "C:/b", "C:/c"]);
    expect(api.saveSettings).toHaveBeenLastCalledWith({
      folders: ["C:/a", "C:/b", "C:/c"],
    });
  });

  it("removeFolder removes one path", () => {
    useStore.setState({ folders: ["C:/a", "C:/b"] });
    useStore.getState().removeFolder("C:/a");
    expect(useStore.getState().folders).toEqual(["C:/b"]);
  });

  it("clearFolders empties the list", () => {
    useStore.setState({ folders: ["C:/a"] });
    useStore.getState().clearFolders();
    expect(useStore.getState().folders).toEqual([]);
  });
});

describe("init", () => {
  it("boots successfully and hydrates settings", async () => {
    vi.mocked(waitForBackend).mockResolvedValue({ port: 1234, token: "t" });
    vi.mocked(api.getSettings).mockResolvedValue({
      folders: ["C:/a"],
      threshold: 0.7,
      lang: "en",
    });
    await useStore.getState().init();
    const s = useStore.getState();
    expect(s.ready).toBe(true);
    expect(s.folders).toEqual(["C:/a"]);
    expect(s.threshold).toBe(0.7);
    expect(s.lang).toBe("en");
    expect(s.screen).toBe("folders");
  });

  it("falls back to defaults for malformed settings", async () => {
    vi.mocked(waitForBackend).mockResolvedValue({ port: 1234, token: "t" });
    vi.mocked(api.getSettings).mockResolvedValue({
      folders: "not-an-array",
      lang: "xx",
    });
    await useStore.getState().init();
    const s = useStore.getState();
    expect(s.folders).toEqual([]);
    expect(s.threshold).toBe(0.6);
    expect(s.lang).toBe("en");
  });

  it("sets a boot error when the backend never comes up", async () => {
    vi.mocked(waitForBackend).mockRejectedValue(new Error("timed out"));
    await useStore.getState().init();
    const s = useStore.getState();
    expect(s.ready).toBe(false);
    expect(s.screen).toBe("boot");
    expect(s.bootError).toContain("timed out");
  });
});
