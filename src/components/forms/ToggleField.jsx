export default function ToggleField({ label, helper, checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-border bg-white p-3 text-left transition hover:border-slate-300 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60"
      onClick={() => onChange(!checked)}
    >
      <span className="min-w-0">
        <strong className="block text-sm text-text-primary">{label}</strong>
        {helper ? <small className="mt-0.5 block text-xs leading-5 text-text-secondary">{helper}</small> : null}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-primary" : "bg-slate-300"}`} aria-hidden="true">
        <i className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${checked ? "left-6" : "left-1"}`} />
      </span>
    </button>
  );
}
