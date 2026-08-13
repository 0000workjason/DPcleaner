import { useEffect } from "react";
import { useStore } from "./store";
import { useT } from "./i18n";
import { Folders } from "./components/Folders";
import { Scanning } from "./components/Scanning";
import { Results } from "./components/Results";
import { Settings } from "./components/Settings";
import { CompareViewer } from "./components/CompareViewer";
import { RenameDialog } from "./components/RenameDialog";
import { Toast } from "./components/Toast";

export default function App() {
  const t = useT();
  const screen = useStore((s) => s.screen);
  const ready = useStore((s) => s.ready);
  const bootError = useStore((s) => s.bootError);
  const init = useStore((s) => s.init);
  const theme = useStore((s) => s.settings.theme);
  const undo = useStore((s) => s.undo);
  const renameTarget = useStore((s) => s.renameTarget);

  useEffect(() => {
    init();
  }, [init]);

  // apply theme (until settings load, keep what main.tsx read from localStorage)
  useEffect(() => {
    if (typeof theme !== "string") return;
    document.documentElement.dataset.theme =
      theme === "light" ? "light" : "dark";
  }, [theme]);

  // global Ctrl+Z undo on the results screen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        !(e.ctrlKey || e.metaKey) ||
        e.key.toLowerCase() !== "z" ||
        screen !== "results"
      )
        return;
      // Never steal Ctrl+Z from a text field: typing in the search box and
      // undoing a typo would otherwise pull the last trashed batch back out of
      // the Recycle Bin instead of undoing the text.
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      )
        return;
      // Nor while a modal owns the screen, or an action is already in flight.
      const s = useStore.getState();
      if (s.busy || s.compare || s.settingsOpen || s.renameTarget) return;

      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, undo]);

  return (
    <>
      {!ready && (
        <div className="screen boot">
          {bootError ? (
            <div className="boot-err">
              <div>{t("boot.failed")}</div>
              <div className="muted small">{bootError}</div>
              <button className="primary" onClick={init}>
                {t("boot.retry")}
              </button>
            </div>
          ) : (
            <div className="boot-msg">
              <div className="spinner" />
              <div className="muted">{t("boot.starting")}</div>
            </div>
          )}
        </div>
      )}

      {ready && screen === "folders" && <Folders />}
      {ready && screen === "scanning" && <Scanning />}
      {ready && screen === "results" && <Results />}

      <Settings />
      <CompareViewer />
      {renameTarget && <RenameDialog />}
      <Toast />
    </>
  );
}
