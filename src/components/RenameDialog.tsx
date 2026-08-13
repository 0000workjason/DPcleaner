import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { useT } from "../i18n";
import { basename } from "../util";
import type { RenameArgs, RenamePreview, RenameResult } from "../types";

const PREVIEW_ROWS = 8;

/** Mirrors the backend's check. The authoritative rejection happens there --
 *  this is only so the user sees why Apply is disabled. A prefix containing a
 *  path separator would move every image out of the folder. */
const BAD_PREFIX = /[\\/:*?"<>|]/;

/** Batch-rename the images in one folder to a numeric sequence (001, 002…).
 *  Lives on the pre-scan Folders screen; previews live and offers a one-click
 *  undo of the rename it just performed. */
export function RenameDialog() {
  const t = useT();
  const folder = useStore((s) => s.renameTarget);
  const close = useStore((s) => s.closeRename);
  const setToast = useStore((s) => s.setToast);

  const [start, setStart] = useState("1");
  const [pad, setPad] = useState(""); // "" = auto
  const [prefix, setPrefix] = useState("");
  const [order, setOrder] = useState<"name" | "date" | "size">("date");

  const [preview, setPreview] = useState<RenamePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RenameResult | null>(null);

  const args: RenameArgs = useMemo(
    () => ({
      folder: folder || "",
      start: parseInt(start, 10) || 0,
      pad: pad === "" ? null : Math.max(0, parseInt(pad, 10) || 0),
      prefix,
      order,
    }),
    [folder, start, pad, prefix, order],
  );

  // Live preview (debounced) while the form changes — but not after applying.
  useEffect(() => {
    if (!folder || result) return;
    if (BAD_PREFIX.test(args.prefix ?? "")) return; // backend would 400 anyway
    let alive = true;
    const id = setTimeout(() => {
      api
        .renamePreview(args)
        .then((p) => {
          if (alive) setPreview(p);
        })
        .catch(() => {
          if (alive) setPreview(null);
        });
    }, 180);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [folder, args, result]);

  if (!folder) return null;

  const onApply = async () => {
    setBusy(true);
    try {
      const r = await api.renameApply(args);
      if (r.renamed === 0 && r.failed.length === 0) {
        setToast(t("toast.renameNone"));
        return;
      }
      if (r.failed.length)
        setToast(t("toast.renamePartialFail", { n: r.failed.length }));
      setResult(r);
    } catch (e) {
      setToast(
        t("toast.renameFail", {
          err: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const onUndo = async () => {
    if (!result?.batch_id) return;
    setBusy(true);
    try {
      const r = await api.renameUndo(result.batch_id);
      setToast(r.ok ? t("toast.renameUndone") : t("toast.renameUndoFail"));
      close();
    } catch (e) {
      // Without this a rejected undo left the dialog open with no explanation.
      setToast(
        t("toast.renameFail", {
          err: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const prefixInvalid = BAD_PREFIX.test(prefix);
  const count = preview?.count ?? 0;
  const rows = preview?.items.slice(0, PREVIEW_ROWS) ?? [];
  const extra = Math.max(0, count - rows.length);

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>{t("rename.title")}</h3>
        <p className="muted small">{t("rename.subtitle")}</p>
        <div className="muted xsmall rename-folder" title={folder}>
          {t("rename.folder")}: {folder}
        </div>

        {result ? (
          /* ---- after applying: result + undo ---- */
          <>
            <div className="rename-done">
              <b>{t("rename.doneTitle")}</b>
              <span>{t("rename.done", { n: result.renamed })}</span>
            </div>
            <div className="modal-actions">
              <button onClick={onUndo} disabled={busy}>
                {t("rename.undo")}
              </button>
              <button className="primary" onClick={close} disabled={busy}>
                {t("rename.close")}
              </button>
            </div>
          </>
        ) : (
          /* ---- form + live preview ---- */
          <>
            <section className="row gap rename-form">
              <label>
                {t("rename.start")}
                <input
                  type="number"
                  min={0}
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                {t("rename.pad")}
                <input
                  type="number"
                  min={0}
                  max={10}
                  placeholder={t("rename.padAuto")}
                  value={pad}
                  onChange={(e) => setPad(e.target.value)}
                />
              </label>
              <label>
                {t("rename.order")}
                <select
                  value={order}
                  onChange={(e) =>
                    setOrder(e.target.value as "name" | "date" | "size")
                  }
                >
                  <option value="name">{t("rename.orderName")}</option>
                  <option value="date">{t("rename.orderDate")}</option>
                  <option value="size">{t("rename.orderSize")}</option>
                </select>
              </label>
              <label className="rename-prefix">
                {t("rename.prefix")}
                <input
                  type="text"
                  value={prefix}
                  maxLength={40}
                  onChange={(e) => setPrefix(e.target.value)}
                />
              </label>
            </section>

            <div className="rename-preview-head muted small">
              {t("rename.preview")} · {t("rename.previewCount", { count })}
            </div>
            {count === 0 ? (
              <div className="rename-empty muted">{t("rename.noImages")}</div>
            ) : (
              <ul className="rename-list">
                {rows.map((it) => (
                  <li key={it.old}>
                    <span className="ren-old" title={it.old}>
                      {basename(it.old)}
                    </span>
                    <span className="ren-arrow">→</span>
                    <span className="ren-new">{basename(it.new)}</span>
                  </li>
                ))}
                {extra > 0 && (
                  <li className="muted">{t("rename.more", { n: extra })}</li>
                )}
              </ul>
            )}

            {prefixInvalid && (
              <div className="rename-warn">{t("rename.prefixInvalid")}</div>
            )}
            {preview && preview.conflicts.length > 0 && (
              <div className="rename-warn">
                {t("rename.conflict", { n: preview.conflicts.length })}
              </div>
            )}
            <p className="muted xsmall">{t("rename.note")}</p>

            <div className="modal-actions">
              <button onClick={close} disabled={busy}>
                {t("confirm.cancel")}
              </button>
              <button
                className="primary"
                onClick={onApply}
                disabled={busy || count === 0 || prefixInvalid}
              >
                {t("rename.apply")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
