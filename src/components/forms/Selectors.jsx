import { months } from "../../features/sales-purchase/data/mockData.js";
import { getAccessibleOutletOptions } from "../../utils/accessControl.js";
import SelectField from "./SelectField.jsx";

export function FieldLabel({ label, children }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

export function OutletSelector({ outlets, value, onChange, auth, includeAll = true }) {
  return (
    <SelectField
      label="Outlet"
      value={value}
      disabled={!outlets.length && !value}
      placeholder={auth ? getAccessibleOutletOptions(auth, outlets, { includeAll: true })[0]?.label : "All Outlets"}
      className="min-w-52"
      searchable
      options={getAccessibleOutletOptions(auth, outlets, { includeAll })}
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
