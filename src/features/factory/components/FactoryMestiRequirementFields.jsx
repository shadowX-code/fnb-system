import AdminSegmentedControl from "../../../components/forms/AdminSegmentedControl.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import AdminMultiSelectGroup, { AdminSelectionActions } from "../../../components/forms/AdminMultiSelectGroup.jsx";

export const mestiWeekdays = [
  { value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" }, { value: 4, label: "Thu" },
  { value: 5, label: "Fri" }, { value: 6, label: "Sat" }, { value: 7, label: "Sun" },
];

export function FactoryMestiWeekdaySelection({ value, onChange, className = "" }) {
  return <AdminMultiSelectGroup label="Weekdays" options={mestiWeekdays} value={value} onChange={onChange} variant="chips" className={className} />;
}

export function FactoryMestiScheduleFields({ frequency, weekdays, status, onFrequencyChange, onWeekdaysChange, onStatusChange }) {
  return <>
    <div><div className="mb-1.5 text-xs font-semibold text-text-secondary">Frequency</div><AdminSegmentedControl label="Frequency" value={frequency} onChange={onFrequencyChange} options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }]} /></div>
    <SelectField label="Status" ariaLabel="Status" value={status} onChange={onStatusChange} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
    {frequency === "weekly" ? <FactoryMestiWeekdaySelection value={weekdays} onChange={onWeekdaysChange} className="md:col-span-2" /> : null}
  </>;
}

export function FactoryMestiLocationSelection({ locations, value, onChange }) {
  return <AdminMultiSelectGroup label="Locations" className="md:col-span-2" options={locations.map(location => ({ value: location.id, label: location.location_name }))} value={value} onChange={onChange} empty={<p className="py-2 text-sm text-text-secondary">No active Locations.</p>}>
    <AdminSelectionActions allSelected={!locations.length || locations.every(location => value.includes(location.id))} empty={!value.length} onSelectAll={() => onChange([...new Set([...value, ...locations.map(location => location.id)])])} onClear={() => onChange([])} />
  </AdminMultiSelectGroup>;
}
