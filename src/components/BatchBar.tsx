import { useState } from "react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { ConfirmModal } from "./ConfirmModal";

type Pending = { kind: "trash"; n: number } | null;

export function BatchBar() {
  const t = useT();
  const selection = useStore((s) => s.selection);
  const undoCount = useStore((s) => s.undoCount);
  const busy = useStore((s) => s.busy);
  const selectAll = useStore((s) => s.selectAll);
  const clearSelection = useStore((s) => s.clearSelection);
  const trashSelected = useStore((s) => s.trashSelected);
  const undo = useStore((s) => s.undo);

  const [pending, setPending] = useState<Pending>(null);
  const selN = selection.size;

  const run = () => {
    if (!pending) return;
    if (pending.kind === "trash") trashSelected();
    setPending(null);
  };

  return (
    <div className="batch-bar">
      <button onClick={selectAll} disabled={busy}>
        {t("batch.selectAll")}
      </button>
      <button onClick={clearSelection} disabled={busy || selN === 0}>
        {t("batch.clear")}
      </button>

      <span className="grow" />

      <button onClick={undo} disabled={busy || undoCount === 0}>
        {t("batch.undo")}
        {undoCount > 0 ? `（${undoCount}）` : ""}
      </button>
      <button
        className="danger"
        disabled={busy || selN === 0}
        onClick={() => setPending({ kind: "trash", n: selN })}
      >
        {t("batch.trash")}（{selN}）
      </button>

      <ConfirmModal
        open={pending !== null}
        danger
        title={t("confirm.trashTitle")}
        message={t("confirm.trashMsg", { n: pending?.n ?? 0 })}
        confirmLabel={t("confirm.trashConfirm")}
        onConfirm={run}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
