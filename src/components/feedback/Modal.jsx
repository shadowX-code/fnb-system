export default function Modal({ title, description, children, footer, onClose }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
      <div className="max-h-[88vh] w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-white shadow-card">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-base font-bold text-text-primary">{title}</h2>
            {description ? <p className="mt-1 text-sm text-text-secondary">{description}</p> : null}
          </div>
          <button className="icon-btn" type="button" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="max-h-[62vh] overflow-y-auto p-5">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-border bg-slate-50 p-4">{footer}</div> : null}
      </div>
    </div>
  );
}
