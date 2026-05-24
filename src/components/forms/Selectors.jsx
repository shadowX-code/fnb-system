import { months } from "../../features/sales-purchase/data/mockData.js";
import SelectField from "./SelectField.jsx";

export function FieldLabel({ label, children }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

export function OutletSelector({ outlets, value, onChange }) {
  return (
    <SelectField
      label="Outlet"
      value={value}
      disabled={!outlets.length && !value}
      placeholder="All Outlets"
      className="min-w-52"
      searchable
      options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))}
      onChange={onChange}
    />
  );
}

export function MonthSelector({ value, onChange }) {
  return (
    <SelectField
      label="Month"
      value={value}
      className="min-w-32"
      options={months.map((month) => ({ value: month.value, label: month.label }))}
      onChange={(nextValue) => onChange(Number(nextValue))}
    />
  );
}

export function YearSelector({ value, onChange }) {
  return (
    <SelectField
      label="Year"
      value={value}
      className="min-w-32"
      options={[2024, 2025, 2026, 2027].map((year) => ({ value: year, label: year }))}
      onChange={(nextValue) => onChange(Number(nextValue))}
    />
  );
}
