import AdminSegmentedControl from "../../../components/forms/AdminSegmentedControl.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";

export const mestiWeekdays = [
  { value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" }, { value: 4, label: "Thu" },
  { value: 5, label: "Fri" }, { value: 6, label: "Sat" }, { value: 7, label: "Sun" },
];

export function FactoryMestiScheduleFields({ frequency, weekdays, status, onFrequencyChange, onWeekdaysChange, onStatusChange }) {
  return <>
    <div><div className="mb-1.5 text-xs font-semibold text-text-secondary">Frequency</div><AdminSegmentedControl label="Frequency" value={frequency} onChange={onFrequencyChange} options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }]} /></div>
    <SelectField label="Status" ariaLabel="Status" value={status} onChange={onStatusChange} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
    {frequency === "weekly" ? <fieldset className="md:col-span-2"><legend className="mb-2 text-xs font-semibold text-text-secondary">Weekdays</legend><div className="flex flex-wrap gap-2">{mestiWeekdays.map(day => <label key={day.value} className="inline-flex items-center gap-2 px-2 py-1.5 text-sm text-text-primary"><input type="checkbox" checked={weekdays.includes(day.value)} onChange={event => onWeekdaysChange(event.target.checked ? [...new Set([...weekdays, day.value])] : weekdays.filter(value => value !== day.value))} />{day.label}</label>)}</div></fieldset> : null}
  </>;
}

export function FactoryMestiLocationSelection({ locations, value, onChange }) {
  return <fieldset className="min-w-0 md:col-span-2"><legend className="text-xs font-semibold text-text-secondary">Locations</legend>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-text-muted">{value.length} selected</span><div className="flex gap-2"><button type="button" className="btn-ghost" onClick={() => onChange([...new Set([...value, ...locations.map(location => location.id)])])}>Select All</button><button type="button" className="btn-ghost" disabled={!value.length} onClick={() => onChange([])}>Clear</button></div></div>
    <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">{locations.map(location => <label key={location.id} className="flex min-w-0 items-start gap-2 py-1.5 text-sm text-text-primary"><input type="checkbox" className="mt-0.5 shrink-0" checked={value.includes(location.id)} onChange={event => onChange(event.target.checked ? [...new Set([...value, location.id])] : value.filter(id => id !== location.id))} /><span className="min-w-0 break-words">{location.location_name}</span></label>)}</div>
    {!locations.length ? <p className="py-2 text-sm text-text-secondary">No active Locations.</p> : null}
  </fieldset>;
}
