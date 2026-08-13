import { useEffect } from "react";
import { openProgress } from "../ws";
import { useStore } from "../store";
import { useT } from "../i18n";

export function Scanning() {
  const t = useT();
  const progress = useStore((s) => s.progress);
  const setProgress = useStore((s) => s.setProgress);
  const cancelScan = useStore((s) => s.cancelScan);
  const progressLost = useStore((s) => s.progressLost);

  useEffect(() => {
    const conn = openProgress(setProgress, progressLost);
    return () => conn.close();
  }, [setProgress, progressLost]);

  // Escape hatch: Stop waits for the backend to confirm the cancellation, which
  // is the right behaviour when it's healthy. Back leaves regardless, so a dead
  // socket or an unresponsive engine can't strand the user on this screen.
  const leave = () => {
    cancelScan();
    useStore.setState({ screen: "folders" });
  };

  const pct = progress.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  // status derived from phase (kept independent of the backend's text, for i18n)
  let label = t("scan.preparing");
  if (progress.phase === "scanning") label = t("scan.scanning");
  else if (progress.phase === "embedding")
    label = `${t("scan.embedding")} ${progress.done}/${progress.total}`;
  // "done" still shows Comparing: the backend is finished, but we stay on this
  // screen until GET /groups returns, and falling through to "Preparing…" made
  // that wait look like the scan had gone backwards.
  else if (progress.phase === "grouping" || progress.phase === "done")
    label = t("scan.grouping");

  return (
    <div className="screen scanning">
      <div className="pct">{pct}%</div>
      <div className="muted scan-status">{label}</div>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="scan-actions">
        <button className="danger" onClick={cancelScan}>
          {t("scan.stop")}
        </button>
        <button className="ghost" onClick={leave}>
          ← {t("scan.back")}
        </button>
      </div>
    </div>
  );
}
