import { useEffect } from "react";
import { useStore } from "../store";

export function Toast() {
  const toast = useStore((s) => s.toast);
  const setToast = useStore((s) => s.setToast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast, setToast]);
  if (!toast) return null;
  return (
    <div className="toast" onClick={() => setToast(null)}>
      {toast}
    </div>
  );
}
