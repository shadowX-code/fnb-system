import DateTimePickerField from "../../../../components/forms/DateTimePickerField.jsx";
import MonthPickerField from "../../../../components/forms/MonthPickerField.jsx";

export default function ClosingCountFields({
  month, cutoff, onMonthChange, onCutoffChange, DateField, className = "",
  monthLabel = "Accounting Month", monthPlaceholder = "Select month",
  countLabel = "Stock Count Date & Time", countHelper = "When the physical stock count was taken.",
  timezone = "Malaysia time", dateLabel = "Date", timeLabel = "Time",
}) {
  return <div className={`grid min-w-0 gap-3 ${className}`}>
    <MonthPickerField label={monthLabel} emptyLabel={monthPlaceholder} value={month} onChange={onMonthChange} />
    <DateTimePickerField label={countLabel} helper={countHelper} timezone={timezone}
      dateLabel={dateLabel} timeLabel={timeLabel} DateField={DateField}
      value={cutoff} onChange={onCutoffChange} withSeconds />
  </div>;
}
