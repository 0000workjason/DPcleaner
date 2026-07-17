import { useT } from "../i18n";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: Props) {
  const t = useT();
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="muted">{message}</p>
        <div className="modal-actions">
          <button onClick={onCancel}>{t("confirm.cancel")}</button>
          <button
            className={danger ? "danger" : "primary"}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel || t("confirm.trashConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
