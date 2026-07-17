import { useMemo } from "react";
import { useStore, type SortBy } from "../store";
import { useT } from "../i18n";

const SORTS: { value: SortBy; key: string }[] = [
  { value: "ctime", key: "sort.ctime" },
  { value: "sim", key: "sort.sim" },
];

export function Toolbar() {
  const t = useT();
  const threshold = useStore((s) => s.threshold);
  const setThreshold = useStore((s) => s.setThreshold);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const data = useStore((s) => s.data);
  const openSettings = useStore((s) => s.openSettings);

  const exts = useMemo(() => {
    const set = new Set<string>();
    data?.groups.forEach((g) => g.members.forEach((m) => set.add(m.ext)));
    return [...set].sort();
  }, [data]);

  return (
    <div className="toolbar">
      <div className="thr">
        <span className="muted">{t("toolbar.threshold")}</span>
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

      <input
        className="search"
        placeholder={t("toolbar.search")}
        value={view.search}
        onChange={(e) => setView({ search: e.target.value })}
      />

      <select
        value={view.sortBy}
        onChange={(e) => setView({ sortBy: e.target.value as SortBy })}
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {t("toolbar.sortPrefix")}
            {t(s.key)}
          </option>
        ))}
      </select>

      <select
        value={view.ext}
        onChange={(e) => setView({ ext: e.target.value })}
      >
        <option value="">{t("toolbar.allFormats")}</option>
        {exts.map((e) => (
          <option key={e} value={e}>
            {e.replace(".", "") || "?"}
          </option>
        ))}
      </select>

      <label className="mingrp muted">
        {t("toolbar.minGroup")}
        <input
          type="number"
          min={2}
          max={50}
          value={view.minGroup}
          onChange={(e) =>
            setView({ minGroup: Math.max(2, parseInt(e.target.value) || 2) })
          }
        />
      </label>

      <button
        className="ghost"
        onClick={() => openSettings(true)}
        title={t("common.settings")}
      >
        ⚙ {t("common.settings")}
      </button>
    </div>
  );
}
