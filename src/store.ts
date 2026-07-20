import { create } from "zustand";
import { api, waitForBackend } from "./api";
import type { GroupsResponse, Progress } from "./types";
import { translate } from "./i18n";
import { isLang, type Lang } from "./lang";

export type Screen = "boot" | "folders" | "scanning" | "results";
export type SortBy = "sim" | "ctime";

interface ViewState {
  sortBy: SortBy;
  search: string;
  ext: string; // "" = all
  minGroup: number; // minimum members in a group
}

interface State {
  ready: boolean;
  bootError: string;
  screen: Screen;
  lang: Lang;

  folders: string[];
  threshold: number;
  device: string | null;

  progress: Progress;
  data: GroupsResponse | null;
  selection: Set<string>;
  undoCount: number;
  busy: boolean;
  toast: string | null;

  settings: Record<string, unknown>;
  view: ViewState;
  compare: string[] | null;
  settingsOpen: boolean;
  renameTarget: string | null; // folder open in the rename dialog

  init: () => Promise<void>;
  addFolders: (paths: string[]) => void;
  removeFolder: (path: string) => void;
  clearFolders: () => void;

  setThreshold: (t: number) => void;
  startScan: () => Promise<void>;
  cancelScan: () => Promise<void>;
  setProgress: (p: Progress) => void;
  refreshGroups: () => Promise<void>;

  toggleSelect: (path: string) => void;
  selectAll: () => void;
  selectPaths: (paths: string[], selected: boolean) => void;
  clearSelection: () => void;

  trashPaths: (paths: string[]) => Promise<void>;
  trashSelected: () => Promise<void>;
  undo: () => Promise<void>;

  setView: (v: Partial<ViewState>) => void;
  openCompare: (paths: string[]) => void;
  closeCompare: () => void;
  openSettings: (open: boolean) => void;
  saveSetting: (key: string, value: unknown) => Promise<void>;
  setLang: (l: Lang) => void;
  setToast: (t: string | null) => void;
  openRename: (folder: string) => void;
  closeRename: () => void;
}

const IDLE: Progress = {
  phase: "idle",
  done: 0,
  total: 0,
  status: "",
  error: "",
};

let thrTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>((set, get) => ({
  ready: false,
  bootError: "",
  screen: "boot",
  lang: "en",
  folders: [],
  threshold: 0.6,
  device: null,
  progress: IDLE,
  data: null,
  selection: new Set(),
  undoCount: 0,
  busy: false,
  toast: null,
  settings: {},
  view: { sortBy: "ctime", search: "", ext: "", minGroup: 2 },
  compare: null,
  settingsOpen: false,
  renameTarget: null,

  init: async () => {
    try {
      await waitForBackend();
      const s = await api.getSettings();
      set({
        ready: true,
        settings: s,
        folders: Array.isArray(s.folders) ? s.folders : [],
        threshold: typeof s.threshold === "number" ? s.threshold : 0.6,
        lang: isLang(s.lang) ? s.lang : "en",
        screen: "folders",
      });
    } catch (e) {
      set({
        bootError: e instanceof Error ? e.message : String(e),
        screen: "boot",
      });
    }
  },

  addFolders: (paths) => {
    const cur = new Set(get().folders);
    for (const p of paths) cur.add(p);
    const folders = [...cur];
    set({ folders });
    get().saveSetting("folders", folders);
  },
  removeFolder: (path) => {
    const folders = get().folders.filter((f) => f !== path);
    set({ folders });
    get().saveSetting("folders", folders);
  },
  clearFolders: () => {
    set({ folders: [] });
    get().saveSetting("folders", []);
  },

  setThreshold: (t) => {
    set({ threshold: t });
    if (get().screen === "results") {
      clearTimeout(thrTimer);
      thrTimer = setTimeout(() => get().refreshGroups(), 180);
    }
    get().saveSetting("threshold", t);
  },

  startScan: async () => {
    const { folders } = get();
    if (folders.length === 0) {
      set({ toast: translate(get().lang, "toast.needFolder") });
      return;
    }
    set({
      screen: "scanning",
      progress: { ...IDLE, phase: "scanning" },
      data: null,
      selection: new Set(),
    });
    try {
      await api.scan(folders, (get().settings.device as string) || undefined);
    } catch (e) {
      set({
        toast: translate(get().lang, "toast.scanStartFail", {
          err: e instanceof Error ? e.message : String(e),
        }),
        screen: "folders",
      });
    }
  },
  cancelScan: async () => {
    await api.cancelScan().catch(() => {});
  },

  setProgress: (p) => {
    set({ progress: p });
    if (p.phase === "done") {
      get()
        .refreshGroups()
        .then(() => set({ screen: "results" }));
    } else if (p.phase === "error") {
      set({
        toast: translate(get().lang, "toast.scanFail", { err: p.error }),
        screen: "folders",
      });
    } else if (p.phase === "cancelled") {
      set({ screen: "folders" });
    }
  },

  refreshGroups: async () => {
    const data = await api.groups(get().threshold);
    // keep selection only for paths that still exist as members
    const present = new Set<string>();
    for (const g of data.groups) for (const m of g.members) present.add(m.path);
    const selection = new Set(
      [...get().selection].filter((p) => present.has(p)),
    );
    set({ data, selection });
  },

  toggleSelect: (path) => {
    const sel = new Set(get().selection);
    if (sel.has(path)) sel.delete(path);
    else sel.add(path);
    set({ selection: sel });
  },
  selectAll: () => {
    const data = get().data;
    if (!data) return;
    const sel = new Set<string>();
    for (const g of data.groups) for (const m of g.members) sel.add(m.path);
    set({ selection: sel });
  },
  selectPaths: (paths, selected) => {
    const sel = new Set(get().selection);
    for (const p of paths) {
      if (selected) sel.add(p);
      else sel.delete(p);
    }
    set({ selection: sel });
  },
  clearSelection: () => set({ selection: new Set() }),

  trashPaths: async (paths) => {
    if (paths.length === 0) return;
    set({ busy: true });
    try {
      const r = await api.trash(paths);
      if (r.failed.length)
        set({
          toast: translate(get().lang, "toast.trashPartialFail", {
            n: r.failed.length,
          }),
        });
      await get().refreshGroups();
      set((s) => ({ undoCount: s.undoCount + (r.ok.length ? 1 : 0) }));
    } finally {
      set({ busy: false });
    }
  },
  trashSelected: async () => {
    const paths = [...get().selection];
    await get().trashPaths(paths);
    set({ selection: new Set() });
  },
  undo: async () => {
    set({ busy: true });
    try {
      const r = await api.undo();
      if (r.failed.length)
        set({
          toast: translate(get().lang, "toast.undoPartialFail", {
            n: r.failed.length,
          }),
        });
      set({ undoCount: r.remaining });
      await get().refreshGroups();
    } finally {
      set({ busy: false });
    }
  },
  setView: (v) => set((s) => ({ view: { ...s.view, ...v } })),
  openCompare: (paths) => set({ compare: paths }),
  closeCompare: () => set({ compare: null }),
  openSettings: (open) => set({ settingsOpen: open }),

  saveSetting: async (key, value) => {
    set((s) => ({ settings: { ...s.settings, [key]: value } }));
    await api.saveSettings({ [key]: value }).catch(() => {});
  },
  setLang: (l) => {
    set({ lang: l });
    get().saveSetting("lang", l);
  },
  setToast: (t) => set({ toast: t }),
  openRename: (folder) => set({ renameTarget: folder }),
  closeRename: () => set({ renameTarget: null }),
}));
