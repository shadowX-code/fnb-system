import { Field } from "./FactoryBulkSelectionModal.jsx";

export default function FactoryDailyToolbar({ children }) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
      {children}
    </div>
  );
}

export function FactoryDailyDateField({ children }) {
  return <div className="w-full sm:w-[170px]"><Field label="Date">{children}</Field></div>;
}
