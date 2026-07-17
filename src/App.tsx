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

  // apply theme
  useEffect(() => {
    document.documentElement.dataset.theme =
      theme === "light" ? "light" : "dark";
  }, [theme]);

  // global Ctrl+Z undo on the results screen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "z" &&
        screen === "results"
      ) {
        e.preventDefault();
        undo();
      }
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
