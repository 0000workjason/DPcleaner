import { useEffect } from "react";
import { useStore } from "../store";

export function Toast() {
  const toast = useStore((s) => s.toast);
  const toastSeq = useStore((s) => s.toastSeq);
  const setToast = useStore((s) => s.setToast);
  // Keyed on the sequence, not the text: two identical messages in a row are
  // the same string, so the effect never re-ran and the second one inherited
  // the first one's already-expiring timer.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toastSeq, toast, setToast]);
  if (!toast) return null;
  return (
    <div className="toast" onClick={() => setToast(null)}>
      {toast}
    </div>
  );
}
