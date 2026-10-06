import { Eye } from "lucide-react";

/** Shared compact record/detail action; workflow resolution remains a text action. */
export default function RecordViewAction({ label, title = label, onClick, disabled = false }) {
  return <button type="button" className="icon-btn" aria-label={label} title={title} onClick={onClick} disabled={disabled}>
    <Eye size={16} aria-hidden="true" />
  </button>;
}
