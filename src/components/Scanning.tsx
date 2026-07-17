import { useEffect } from "react";
import { openProgress } from "../ws";
import { useStore } from "../store";
import { useT } from "../i18n";

export function Scanning() {
  const t = useT();
  const progress = useStore((s) => s.progress);
  const setProgress = useStore((s) => s.setProgress);
  const cancelScan = useStore((s) => s.cancelScan);

  useEffect(() => {
    const conn = openProgress(setProgress);
    return () => conn.close();
  }, [setProgress]);

  const pct = progress.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  // status derived from phase (kept independent of the backend's text, for i18n)
  let label = t("scan.preparing");
  if (progress.phase === "scanning") label = t("scan.scanning");
  else if (progress.phase === "embedding")
    label = `${t("scan.embedding")} ${progress.done}/${progress.total}`;
  else if (progress.phase === "grouping") label = t("scan.grouping");

  return (
    <div className="screen scanning">
      <div className="pct">{pct}%</div>
      <div className="muted scan-status">{label}</div>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <button className="danger" onClick={cancelScan}>
        {t("scan.stop")}
      </button>
    </div>
  );
}
