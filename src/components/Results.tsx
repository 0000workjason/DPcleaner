import { useMemo } from "react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { Toolbar } from "./Toolbar";
import { StatsBar } from "./StatsBar";
import { BatchBar } from "./BatchBar";
import { GroupCard } from "./GroupCard";
import { sortGroups, filterGroups } from "../groups";

export function Results() {
  const t = useT();
  const data = useStore((s) => s.data);
  const view = useStore((s) => s.view);
  const goFolders = () => useStore.setState({ screen: "folders" });

  const visible = useMemo(
    () =>
      data ? sortGroups(filterGroups(data.groups, view), view.sortBy) : [],
    [data, view],
  );

  return (
    <div className="screen results">
      <div className="results-top">
        <button className="ghost" onClick={goFolders}>
          ← {t("results.back")}
        </button>
        <Toolbar />
      </div>
      <StatsBar />

      <div className="gallery">
        {visible.length === 0 ? (
          <div className="empty muted">
            {data && data.groups.length === 0
              ? t("results.emptyNoDup")
              : t("results.emptyNoFilter")}
          </div>
        ) : (
          visible.map((g) => <GroupCard key={g.id} group={g} />)
        )}
      </div>

      <BatchBar />
    </div>
  );
}
