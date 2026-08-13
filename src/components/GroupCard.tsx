import { Thumb } from "./Thumb";
import { useStore } from "../store";
import { useT } from "../i18n";
import { fmtSize } from "../util";
import type { Group } from "../types";

export function GroupCard({ group }: { group: Group }) {
  const t = useT();
  const selection = useStore((s) => s.selection);
  const toggleSelect = useStore((s) => s.toggleSelect);
  const selectPaths = useStore((s) => s.selectPaths);
  const openCompare = useStore((s) => s.openCompare);

  const memberPaths = group.members.map((m) => m.path);
  const allSelected = memberPaths.every((p) => selection.has(p));

  // similarity as a percentage; collapse to one value when the range rounds equal
  const lo = Math.round(group.sim_min * 100);
  const hi = Math.round(group.sim_max * 100);
  const simRange = lo === hi ? `${lo}%` : `${lo}%–${hi}%`;

  return (
    <div className="group-card">
      <div className="group-head">
        <div className="group-title">
          <b>{t("group.count", { n: group.members.length })}</b>
          <span className="muted">
            {t("group.similarity", { range: simRange })}
          </span>
          <span className="muted">
            {t("group.total", { size: fmtSize(group.total_size) })}
          </span>
        </div>
        <div className="group-actions">
          <button onClick={() => openCompare(memberPaths)}>
            {t("group.compare")}
          </button>
          <button onClick={() => selectPaths(memberPaths, !allSelected)}>
            {allSelected ? t("group.deselectGroup") : t("group.selectGroup")}
          </button>
        </div>
      </div>

      <div className="tiles">
        {group.members.map((m) => {
          const selected = selection.has(m.path);
          return (
            <div
              key={m.path}
              className={`tile ${selected ? "selected" : ""}`}
              onClick={() => toggleSelect(m.path)}
              // right-click opens our own zoom view instead of the browser's native menu
              onContextMenu={(e) => {
                e.preventDefault();
                openCompare([m.path]);
              }}
            >
              <div className="tile-thumb">
                {/* clicking the image selects it; use the Compare button for the zoom view */}
                <Thumb
                  path={m.path}
                  size={360}
                  version={`${m.size}-${m.ctime}`}
                />
                <label
                  className="badge pick"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleSelect(m.path)}
                  />
                  {t("tile.select")}
                </label>
              </div>
              <div className="tile-meta">
                <div className="tile-name" title={m.path}>
                  {m.name}
                </div>
                <div className="muted small">
                  {m.width}×{m.height} · {fmtSize(m.size)} ·{" "}
                  {m.ext.replace(".", "")}
                </div>
                <div className="muted xsmall" title={m.folder}>
                  {m.folder}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
