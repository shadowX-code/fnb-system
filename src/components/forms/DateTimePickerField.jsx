import DatePickerField from './DatePickerField.jsx';
import TimePickerField from './TimePickerField.jsx';

// A wall-clock value; the consuming authority owns timezone-to-instant conversion.
export default function DateTimePickerField({label,value='',onChange,timezone,helper,error}) {
 const [date='',time='']=value.split('T');
 return <fieldset className="space-y-2"><legend className="text-sm font-medium">{label}</legend>
 <div className="grid grid-cols-2 gap-3"><DatePickerField label={`${label} date`} value={date} onChange={next=>onChange(next?`${next}T${time}`:'')}/><TimePickerField label={`${label} time`} value={time} onChange={next=>onChange(`${date}T${next}`)}/></div>
 <p className="text-xs text-text-secondary">{timezone}{helper?` · ${helper}`:''}</p>{error?<p className="text-sm text-danger" role="alert">{error}</p>:null}</fieldset>;
}
