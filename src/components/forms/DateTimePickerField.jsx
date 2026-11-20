import DatePickerField from './DatePickerField.jsx';
import TimePickerField from './TimePickerField.jsx';

// A wall-clock value; the consuming authority owns timezone-to-instant conversion.
export default function DateTimePickerField({
 label, value = '', onChange, timezone, helper, error, dateLabel = `${label} date`,
 timeLabel = `${label} time`, withSeconds = false, disabled = false,
}) {
 const [date='',time='']=value.split('T');
 return <fieldset disabled={disabled} className="min-w-0 space-y-2"><legend className="text-sm font-medium">{label}</legend>
 <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] items-end gap-3"><DatePickerField label={dateLabel} value={date} onChange={next=>onChange(next ? `${next}T${time}` : '')}/><TimePickerField label={timeLabel} value={time} onChange={next=>onChange(`${date}T${next}`)} withSeconds={withSeconds}/></div>
 <p className="text-xs text-text-secondary">{timezone}{helper ? <> · <span>{helper}</span></> : null}</p>{error?<p className="text-sm text-danger" role="alert">{error}</p>:null}</fieldset>;
}
