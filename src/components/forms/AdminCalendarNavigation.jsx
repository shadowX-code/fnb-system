import {ChevronLeft,ChevronRight} from 'lucide-react';
import MonthPickerField from './MonthPickerField.jsx';
import DatePickerField from './DatePickerField.jsx';

/** Calendar consumers retain date, period and timezone authority. */
export default function AdminCalendarNavigation({value,onChange,onPrevious,onNext,disabled=false,label='Calendar navigation',previousLabel='Previous period',nextLabel='Next period'}){
 return <div className="admin-calendar-navigation" role="group" aria-label={label}>
  <MonthPickerField ariaLabel="Month / Year" value={value.slice(0,7)} onChange={month=>onChange(month+'-01')} disabled={disabled}/>
  <button type="button" className="btn-secondary icon-btn" aria-label={previousLabel} disabled={disabled} onClick={onPrevious}><ChevronLeft size={16}/></button>
  <DatePickerField triggerLabel="Today" value={value} onChange={date=>{if(date)onChange(date)}} disabled={disabled}/>
  <button type="button" className="btn-secondary icon-btn" aria-label={nextLabel} disabled={disabled} onClick={onNext}><ChevronRight size={16}/></button>
 </div>;
}
