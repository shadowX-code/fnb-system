import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export default function ConfirmDialog({ request, onCancel, onConfirm }) {
  const panelRef = useRef(null), cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const active = !!request;
  useEffect(() => {
    if (!active) return undefined;
    const previous = document.activeElement, panel = panelRef.current;
    panel?.querySelector('button')?.focus();
    function handleKeyDown(event) {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); cancelRef.current?.(); }
      if (event.key !== "Tab") return;
      const buttons = panel?.querySelectorAll('button:not(:disabled)');
      const first = buttons?.[0], last = buttons?.[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("keydown", handleKeyDown); if (previous?.isConnected) previous.focus?.(); };
  }, [active]);

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
        ref={panelRef}
        className="relative z-confirm-content-layer w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-base font-bold text-text-primary">{request.title}</h2>
        <p className="mt-2 text-sm text-text-secondary">{request.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" type="button" onClick={onCancel}>
            {request.cancelLabel ?? "Cancel"}
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
