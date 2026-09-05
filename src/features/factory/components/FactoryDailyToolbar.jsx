import { RefreshCw } from "lucide-react";
import { Field } from "./FactoryBulkSelectionModal.jsx";

export default function FactoryDailyToolbar({ children, onRefresh, loading = false }) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
      <div className="w-full sm:w-[170px]">{children}</div>
      {onRefresh ? <button className="btn-secondary h-10 px-3 text-sm" type="button" disabled={loading} onClick={onRefresh}><RefreshCw size={15} /> Refresh</button> : null}
    </div>
  );
}

export function FactoryDailyDateField({ children }) {
  return <Field label="Date">{children}</Field>;
}
