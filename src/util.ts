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
