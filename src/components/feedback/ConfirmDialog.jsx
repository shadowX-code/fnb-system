export default function ConfirmDialog({ request, onCancel, onConfirm }) {
  if (!request) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-white p-5 shadow-card">
        <h2 className="text-base font-bold text-text-primary">{request.title}</h2>
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
    </div>
  );
}
