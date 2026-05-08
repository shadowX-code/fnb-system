const toneStyles = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-rose-200 bg-rose-50 text-rose-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
};

export default function ToastViewport({ toasts, onDismiss }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-3">
      {toasts.map((toast) => {
        return (
          <button
            key={toast.id}
            type="button"
            onClick={() => onDismiss(toast.id)}
            className={`flex items-start gap-3 rounded-2xl border p-4 text-left text-sm shadow-card ${toneStyles[toast.tone ?? "info"]}`}
          >
            <span className="mt-0.5 shrink-0 font-bold">{toast.tone === "error" ? "!" : toast.tone === "success" ? "✓" : "i"}</span>
            <span>
              <span className="block font-bold">{toast.title}</span>
              {toast.message ? <span className="mt-1 block opacity-80">{toast.message}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
