import { useRef } from "react";
import { FileText, Paperclip, UploadCloud, X } from "lucide-react";

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function AdminEvidenceFilePicker({ file, onChange, accept, disabled = false, label = "Choose evidence", helper = "JPG, PNG, WebP or PDF · up to 10 MB" }) {
  const inputRef = useRef(null);
  const input = <input ref={inputRef} className="sr-only" type="file" accept={accept} disabled={disabled} aria-label={label} onChange={(event) => onChange(event.target.files?.[0] || null)} />;

  if (!file) {
    return <><button className="flex min-h-24 w-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-slate-50 px-4 py-3 text-center transition hover:border-primary/40 hover:bg-primary/[0.03] focus:outline-none focus:ring-2 focus:ring-primary/15" type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>
      <UploadCloud className="text-primary" size={20} />
      <span className="mt-2 text-sm font-semibold text-text-primary">{label}</span>
      <span className="mt-0.5 text-xs text-text-muted">{helper}</span>
    </button>{input}</>;
  }

  return <><div className="flex min-h-20 items-center gap-3 rounded-xl border border-border bg-slate-50 px-3 py-3">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-white text-primary">{file.type === "application/pdf" ? <FileText size={18} /> : <Paperclip size={18} />}</span>
    <div className="min-w-0 flex-1"><strong className="block truncate text-sm text-text-primary">{file.name}</strong><span className="mt-0.5 block text-xs text-text-muted">{formatBytes(file.size)}</span></div>
    <button className="btn-secondary h-9 px-3 text-xs" type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>Replace</button>
    <button className="icon-btn" type="button" disabled={disabled} aria-label="Remove evidence" onClick={() => onChange(null)}><X size={16} /></button>
  </div>{input}</>;
}
