import { create } from "zustand";
import { api, waitForBackend } from "./api";
import type { GroupsResponse, Progress } from "./types";
import { translate } from "./i18n";
import { isLang, type Lang } from "./lang";
import { filterGroups } from "./groups";

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
  starting: boolean;
  toast: string | null;
  /** Bumped on every toast so an identical repeat still restarts its timer. */
  toastSeq: number;

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
  progressLost: () => void;
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

export const THEME_KEY = "dpc.theme";

let thrTimer: ReturnType<typeof setTimeout> | undefined;
/** Guards against a second init() while the first is still polling. */
let booting = false;
/** Monotonic id so a slow earlier /groups can't overwrite a newer result. */
let groupsSeq = 0;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** State patch that shows `text` and advances the toast sequence. */
const withToast = (s: State, text: string, extra: Partial<State> = {}) => ({
  ...extra,
  toast: text,
  toastSeq: s.toastSeq + 1,
});

/** Paths the user can actually see under the active toolbar filters. */
function visiblePaths(
  data: GroupsResponse | null,
  view: ViewState,
): Set<string> {
  const out = new Set<string>();
  if (!data) return out;
  for (const g of filterGroups(data.groups, view))
    for (const m of g.members) out.add(m.path);
  return out;
}

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
  starting: false,
  toast: null,
  toastSeq: 0,
  settings: {},
  view: { sortBy: "ctime", search: "", ext: "", minGroup: 2 },
  compare: null,
  settingsOpen: false,
  renameTarget: null,

  init: async () => {
    if (booting) return; // Retry spam would otherwise stack polling loops
    booting = true;
    set({ bootError: "" }); // clear it, or Retry shows the old error with no spinner
    try {
      await waitForBackend();
      const s = await api.getSettings();
      if (typeof s.theme === "string") {
        try {
          localStorage.setItem(THEME_KEY, s.theme);
        } catch {
          /* private mode / storage disabled - cosmetic only */
        }
      }
      set({
        ready: true,
        settings: s,
        folders: Array.isArray(s.folders) ? s.folders : [],
        threshold: typeof s.threshold === "number" ? s.threshold : 0.6,
        lang: isLang(s.lang) ? s.lang : "en",
        screen: "folders",
      });
    } catch (e) {
      set({ bootError: errMsg(e), screen: "boot" });
    } finally {
      booting = false;
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
    // Both the refetch and the save are debounced. A range drag fires dozens of
    // input events per second, and one POST /settings each is a read-modify-write
    // storm that used to be able to truncate the settings file.
    clearTimeout(thrTimer);
    thrTimer = setTimeout(() => {
      get().saveSetting("threshold", get().threshold);
      if (get().screen === "results") get().refreshGroups();
    }, 180);
  },

  startScan: async () => {
    const { folders, starting } = get();
    if (folders.length === 0) {
      set((s) => withToast(s, translate(get().lang, "toast.needFolder")));
      return;
    }
    if (starting) return; // double-click would race the backend's own guard
    set({
      starting: true,
      screen: "scanning",
      progress: { ...IDLE, phase: "scanning" },
      data: null,
      selection: new Set(),
    });
    try {
      await api.scan(folders, (get().settings.device as string) || undefined);
    } catch (e) {
      const msg = errMsg(e);
      if (msg.includes("409")) {
        // A scan is already running. Its progress still arrives on the socket,
        // so stay on this screen instead of stranding it with nobody listening.
        set((s) =>
          withToast(s, translate(get().lang, "toast.scanAlreadyRunning")),
        );
      } else {
        set((s) =>
          withToast(
            s,
            translate(get().lang, "toast.scanStartFail", { err: msg }),
            {
              screen: "folders",
            },
          ),
        );
      }
    } finally {
      set({ starting: false });
    }
  },
  cancelScan: async () => {
    try {
      await api.cancelScan();
    } catch (e) {
      set((s) =>
        withToast(
          s,
          translate(get().lang, "toast.cancelFail", { err: errMsg(e) }),
        ),
      );
    }
  },

  setProgress: (p) => {
    set({ progress: p });
    if (p.phase === "done") {
      get()
        .refreshGroups()
        .then(() => set({ screen: "results" }))
        .catch((e) =>
          // Without this the socket is already closed by the backend, so a
          // failed /groups left the user stuck at 100% with no way out.
          set((s) =>
            withToast(
              s,
              translate(get().lang, "toast.groupsFail", { err: errMsg(e) }),
              { screen: "folders" },
            ),
          ),
        );
    } else if (p.phase === "error") {
      set((s) =>
        withToast(
          s,
          translate(get().lang, "toast.scanFail", { err: p.error }),
          {
            screen: "folders",
          },
        ),
      );
    } else if (p.phase === "cancelled") {
      set({ screen: "folders" });
    }
  },

  /** The progress socket dropped without a terminal frame (backend crash,
   *  machine sleep). Nothing else can move us off the Scanning screen. */
  progressLost: () => {
    if (get().screen !== "scanning") return;
    set((s) =>
      withToast(s, translate(get().lang, "toast.progressLost"), {
        screen: "folders",
      }),
    );
  },

  refreshGroups: async () => {
    const seq = ++groupsSeq;
    const data = await api.groups(get().threshold);
    if (seq !== groupsSeq) return; // a newer request already landed
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
    const { data, view } = get();
    if (!data) return;
    // Only what's visible under the current filters: selecting hidden groups
    // and then hitting Trash deletes files the user never saw.
    set({ selection: visiblePaths(data, view) });
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
        set((s) =>
          withToast(
            s,
            translate(get().lang, "toast.trashPartialFail", {
              n: r.failed.length,
            }),
          ),
        );
      // Bump the undo count before the refetch: if /groups then fails, the
      // files are still in the Recycle Bin and Undo must stay reachable.
      if (r.ok.length) set((s) => ({ undoCount: s.undoCount + 1 }));
      await get().refreshGroups();
    } catch (e) {
      set((s) =>
        withToast(
          s,
          translate(get().lang, "toast.trashFail", { err: errMsg(e) }),
        ),
      );
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
    if (get().busy) return; // holding Ctrl+Z would otherwise fire concurrent undos
    set({ busy: true });
    try {
      const r = await api.undo();
      if (r.failed.length)
        set((s) =>
          withToast(
            s,
            translate(get().lang, "toast.undoPartialFail", {
              n: r.failed.length,
            }),
          ),
        );
      set({ undoCount: r.remaining });
      await get().refreshGroups();
    } catch (e) {
      set((s) =>
        withToast(
          s,
          translate(get().lang, "toast.undoFail", { err: errMsg(e) }),
        ),
      );
    } finally {
      set({ busy: false });
    }
  },
  setView: (v) => {
    const view = { ...get().view, ...v };
    const { data, selection } = get();
    let next = selection;
    if (selection.size && data) {
      // Same reason as selectAll: a selection made under a wider filter must
      // not survive into a narrower one and get trashed unseen.
      const visible = visiblePaths(data, view);
      next = new Set([...selection].filter((p) => visible.has(p)));
    }
    set({ view, selection: next });
  },
  openCompare: (paths) => set({ compare: paths }),
  closeCompare: () => set({ compare: null }),
  openSettings: (open) => set({ settingsOpen: open }),

  saveSetting: async (key, value) => {
    set((s) => ({ settings: { ...s.settings, [key]: value } }));
    if (key === "theme") {
      // Mirrored locally so the next launch paints the right theme immediately,
      // instead of flashing dark until GET /settings comes back.
      try {
        localStorage.setItem(THEME_KEY, String(value));
      } catch {
        /* private mode / storage disabled - cosmetic only */
      }
    }
    try {
      await api.saveSettings({ [key]: value });
    } catch {
      set((s) => withToast(s, translate(get().lang, "toast.settingsFail")));
    }
  },
  setLang: (l) => {
    set({ lang: l });
    get().saveSetting("lang", l);
  },
  setToast: (t) => set((s) => ({ toast: t, toastSeq: s.toastSeq + 1 })),
  openRename: (folder) => set({ renameTarget: folder }),
  closeRename: () => set({ renameTarget: null }),
}));
