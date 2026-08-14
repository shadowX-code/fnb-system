import { Search } from "lucide-react";

export default function FactoryMasterTableToolbar({ value, onChange, placeholder }) {
  return <div className="mb-4 rounded-xl border border-border bg-slate-50 p-3"><label className="relative block w-full md:max-w-[400px]"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={16} /><span className="sr-only">{placeholder}</span><input className="field-input h-10 w-full pl-9" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label></div>;
}
