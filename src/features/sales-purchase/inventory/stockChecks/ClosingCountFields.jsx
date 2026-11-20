export default function ClosingCountFields({
  month, cutoff, onMonthChange, onCutoffChange,
  monthLabel = "Accounting Month", cutoffLabel = "Physical Count Cutoff (Malaysia time)",
  inputClassName,
}) {
  return <>
    <label className="grid min-w-0 gap-1"><span>{monthLabel}</span>
      <input className={inputClassName} type="month" value={month} onChange={event => onMonthChange(event.target.value)} required />
    </label>
    <label className="grid min-w-0 gap-1"><span>{cutoffLabel}</span>
      <input className={inputClassName} type="datetime-local" step="1" value={cutoff} onChange={event => onCutoffChange(event.target.value)} required />
    </label>
  </>;
}
