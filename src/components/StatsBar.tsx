import { useMemo } from "react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { fmtSize } from "../util";

export function StatsBar() {
  const t = useT();
  const data = useStore((s) => s.data);
  const selection = useStore((s) => s.selection);

  const selStats = useMemo(() => {
    if (!data) return { count: 0, bytes: 0 };
    let bytes = 0;
    for (const g of data.groups)
      for (const m of g.members) if (selection.has(m.path)) bytes += m.size;
    return { count: selection.size, bytes };
  }, [data, selection]);

  if (!data) return null;
  const s = data.stats;
  return (
    <div className="stats-bar">
      <span>{t("stats.groups", { n: s.groups })}</span>
      <span>{t("stats.images", { n: s.images })}</span>
      <span className="sep" />
      <span className={selStats.count ? "accent" : "muted"}>
        {t("stats.selected", {
          n: selStats.count,
          size: fmtSize(selStats.bytes),
        })}
      </span>
    </div>
  );
}
