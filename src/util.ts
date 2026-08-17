export function fmtSize(n: number): string {
  let s = n;
  for (const u of ["B", "KB", "MB", "GB", "TB"]) {
    if (s < 1024 || u === "TB")
      return `${s < 10 && u !== "B" ? s.toFixed(1) : Math.round(s)} ${u}`;
    s /= 1024;
  }
  return `${n} B`;
}

export function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/** True for elements that own their text editing, so we must not steal their
 *  context menu or their undo. */
export function isEditable(el: HTMLElement | null): boolean {
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    // `=== true`, not truthiness: jsdom leaves this undefined, and the bare
    // expression would then leak undefined out of a `: boolean` signature.
    el.isContentEditable === true
  );
}

/** Suppress the WebView's native page menu (reload / print / inspect), which
 *  has nothing to offer in a desktop app. Text fields keep theirs: right-click
 *  paste is the only mouse-driven way to fill in a folder path. */
export function suppressContextMenu(e: MouseEvent): void {
  if (!isEditable(e.target as HTMLElement | null)) e.preventDefault();
}
