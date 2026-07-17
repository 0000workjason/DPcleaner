import { useCallback, useEffect, useRef, useState } from "react";
import { imgUrl } from "../api";
import { useStore } from "../store";
import { useT } from "../i18n";
import { basename } from "../util";

/** Full-screen overlay that shows the group's copies side by side with a single
 *  shared zoom/pan, so the same region lines up across every version. */
export function CompareViewer() {
  const tr = useT();
  const paths = useStore((s) => s.compare);
  const close = useStore((s) => s.closeCompare);
  const [scale, setScale] = useState(1);
  const [t, setT] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(
    null,
  );

  const reset = useCallback(() => {
    setScale(1);
    setT({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    reset();
  }, [paths, reset]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "0") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, reset]);

  if (!paths || paths.length === 0) return null;

  const cols = Math.min(4, paths.length); // at most 4 photos per horizontal row

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setScale((s) => Math.min(12, Math.max(1, s * factor)));
  };
  const onDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    drag.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setT({
      x: drag.current.tx + (e.clientX - drag.current.x),
      y: drag.current.ty + (e.clientY - drag.current.y),
    });
  };
  const onUp = () => (drag.current = null);

  return (
    <div
      className="compare-backdrop"
      onContextMenu={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="compare-head">
        <span className="muted">{tr("compare.hint", { n: paths.length })}</span>
        <div className="grow" />
        <button onClick={reset}>{tr("compare.reset")}</button>
        <button onClick={close}>{tr("compare.close")} ✕</button>
      </div>
      <div
        className="compare-row"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      >
        {paths.map((p) => (
          <div className="compare-pane" key={p}>
            <div className="compare-name">{basename(p)}</div>
            <div className="compare-clip">
              <img
                className="compare-img"
                src={imgUrl(p, 2048, "image")}
                draggable={false}
                style={{
                  transform: `translate(${t.x}px, ${t.y}px) scale(${scale})`,
                }}
                alt={p}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
