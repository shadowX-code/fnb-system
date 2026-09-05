import { Search } from "lucide-react";
import FactoryFilterBar from "./FactoryFilterBar.jsx";
import { inputClass } from "./FactoryBulkSelectionModal.jsx";

export default function FactoryMasterTableToolbar({ value, onChange, placeholder }) {
  const activeFilters = value ? [{ key: "search", label: "Search", value, onRemove: () => onChange("") }] : [];
  return <FactoryFilterBar activeFilters={activeFilters} onClear={() => onChange("")} className="mb-1"><label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={16} /><span className="sr-only">{placeholder}</span><input className={`${inputClass()} pl-9`} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label></FactoryFilterBar>;
}
