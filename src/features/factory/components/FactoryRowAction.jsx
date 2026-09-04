import { Eye } from "lucide-react";

export default function FactoryRowAction({ label = "View details", onClick, disabled = false }) {
  return (
    <button className="icon-btn h-8 w-8" type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <Eye size={16} />
    </button>
  );
}
