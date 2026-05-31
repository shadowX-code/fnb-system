import { useEffect } from "react";
import { createPortal } from "react-dom";

export default function ConfirmDialog({ request, onCancel, onConfirm }) {
  useEffect(() => {
    if (!request) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") onCancel?.();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, request]);

  if (!request) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-confirm-layer flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onMouseDown={onCancel}
    >
      <div
        className="relative z-confirm-content-layer w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-base font-bold text-text-primary">{request.title}</h2>
        <p className="mt-2 text-sm text-text-secondary">{request.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={request.danger ? "inline-flex h-10 items-center justify-center rounded-control bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-700" : "btn-primary"}
            type="button"
            onClick={onConfirm}
          >
            {request.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
