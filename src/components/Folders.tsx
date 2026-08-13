import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useStore } from "../store";
import { useT } from "../i18n";

export function Folders() {
  const t = useT();
  const folders = useStore((s) => s.folders);
  const addFolders = useStore((s) => s.addFolders);
  const removeFolder = useStore((s) => s.removeFolder);
  const clearFolders = useStore((s) => s.clearFolders);
  const threshold = useStore((s) => s.threshold);
  const setThreshold = useStore((s) => s.setThreshold);
  const startScan = useStore((s) => s.startScan);
  const openSettings = useStore((s) => s.openSettings);
  const openRename = useStore((s) => s.openRename);
  const setToast = useStore((s) => s.setToast);
  const starting = useStore((s) => s.starting);

  const pick = async () => {
    try {
      const sel = await open({ directory: true, multiple: true });
      if (Array.isArray(sel)) addFolders(sel);
      else if (typeof sel === "string") addFolders([sel]);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    }
  };

  // OS drag-and-drop of folders onto the window
  useEffect(() => {
    // `cancelled` matters: if cleanup runs before the promise resolves, the
    // listener would be registered afterwards with nothing left to remove it.
    // React StrictMode does mount -> cleanup -> mount on every dev mount, so
    // the first listener leaked permanently and kept firing on other screens.
    let cancelled = false;
    let un: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type === "drop" && e.payload.paths?.length)
          addFolders(e.payload.paths);
      })
      .then((f) => {
        if (cancelled) f();
        else un = f;
      })
      .catch(() => {
        /* drag-drop unavailable; picking folders still works */
      });
    return () => {
      cancelled = true;
      un?.();
    };
  }, [addFolders]);

  return (
    <div className="screen folders">
      <header className="folders-head">
        <div>
          <h1>{t("folders.title")}</h1>
          <p className="muted">{t("folders.subtitle")}</p>
        </div>
        <button className="ghost" onClick={() => openSettings(true)}>
          ⚙ {t("common.settings")}
        </button>
      </header>

      <div
        className="folder-list"
        onClick={(e) => e.currentTarget === e.target && pick()}
      >
        {folders.length === 0 && (
          <div className="placeholder" onClick={pick}>
            {t("folders.placeholder")}
          </div>
        )}
        {folders.map((f) => (
          <div className="folder-row" key={f}>
            <span className="folder-path" title={f}>
              {f}
            </span>
            <button className="tiny" onClick={() => openRename(f)}>
              {t("folders.rename")}
            </button>
            <button
              className="tiny danger-ghost"
              onClick={() => removeFolder(f)}
            >
              {t("folders.remove")}
            </button>
          </div>
        ))}
      </div>

      <div className="thr-row">
        <span className="muted">{t("folders.threshold")}</span>
        <input
          type="range"
          min={0.5}
          max={0.85}
          step={0.01}
          value={threshold}
          onChange={(e) => setThreshold(parseFloat(e.target.value))}
        />
        <span className="thr-val">{Math.round(threshold * 100)}%</span>
      </div>

      <footer className="folders-foot">
        <button onClick={pick}>{t("folders.add")}</button>
        <button
          className="ghost"
          onClick={clearFolders}
          disabled={folders.length === 0}
        >
          {t("folders.clearAll")}
        </button>
        <span className="grow" />
        <button
          className="primary big"
          onClick={startScan}
          disabled={folders.length === 0 || starting}
        >
          {t("folders.startScan")}
        </button>
      </footer>
    </div>
  );
}
