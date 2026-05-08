import { months } from "../../features/sales-purchase/data/mockData.js";

export function FieldLabel({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

export function OutletSelector({ outlets, value, onChange }) {
  return (
    <FieldLabel label="Outlet">
      <select className="control min-w-52" value={value} onChange={(event) => onChange(event.target.value)}>
        {outlets.map((outlet) => (
          <option key={outlet.id} value={outlet.id}>
            {outlet.name}
          </option>
        ))}
      </select>
    </FieldLabel>
  );
}

export function MonthSelector({ value, onChange }) {
  return (
    <FieldLabel label="Month">
      <select className="control" value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {months.map((month) => (
          <option key={month.value} value={month.value}>
            {month.label}
          </option>
        ))}
      </select>
    </FieldLabel>
  );
}

export function YearSelector({ value, onChange }) {
  return (
    <FieldLabel label="Year">
      <select className="control" value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {[2024, 2025, 2026, 2027].map((year) => (
          <option key={year} value={year}>{year}</option>
        ))}
      </select>
    </FieldLabel>
  );
}
