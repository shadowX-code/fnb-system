import DateTimePickerField from "../../../../components/forms/DateTimePickerField.jsx";
import MonthPickerField from "../../../../components/forms/MonthPickerField.jsx";

export default function ClosingCountFields({ month, cutoff, onMonthChange, onCutoffChange, className = "" }) {
  return <div className={`grid min-w-0 gap-3 ${className}`}>
    <MonthPickerField label="Accounting Month" emptyLabel="Select month" value={month} onChange={onMonthChange} />
    <DateTimePickerField label="Stock Count Date & Time" helper="When the physical stock count was taken." timezone="Malaysia time"
      dateLabel="Date" timeLabel="Time" value={cutoff} onChange={onCutoffChange} withSeconds />
  </div>;
}
