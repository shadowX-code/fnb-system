import { Field } from "./FactoryBulkSelectionModal.jsx";

export default function FactoryDailyToolbar({ children }) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
      <div className="w-full sm:w-[170px]">{children}</div>
    </div>
  );
}

export function FactoryDailyDateField({ children }) {
  return <Field label="Date">{children}</Field>;
}
