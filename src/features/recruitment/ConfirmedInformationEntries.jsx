import AdminFormField from "../../components/forms/AdminFormField.jsx";

// Shared editor for bounded, opening-owned explanatory facts, not requirements or offer terms.
export default function ConfirmedInformationEntries({ value = [], onChange }) {
  const patch = (index, key, text) => onChange(value.map((entry,i) => i === index ? {...entry,[key]:text} : entry));
  return <div className="space-y-3">
    <p className="recruitment-config-note">Optional confirmed information only. Keep pay, hours and benefits in Employment Offerings, and hiring conditions in Job Requirements.</p>
    {value.map((entry,index) => <div key={index} className="grid gap-3 border-b border-border pb-3 md:grid-cols-[1fr_2fr_auto]">
      <AdminFormField label="Topic"><input className="control w-full" maxLength={120} value={entry.topic} onChange={e=>patch(index,"topic",e.target.value)} /></AdminFormField>
      <AdminFormField label="Confirmed Information"><textarea className="control w-full" rows={2} maxLength={1000} value={entry.information} onChange={e=>patch(index,"information",e.target.value)} /></AdminFormField>
      <button type="button" className="btn-secondary self-end" aria-label={`Remove information ${index+1}`} onClick={()=>onChange(value.filter((_,i)=>i!==index))}>Remove</button>
    </div>)}
    <button type="button" className="btn-secondary" disabled={value.length>=10} onClick={()=>onChange([...value,{topic:"",information:""}])}>Add confirmed information</button>
  </div>;
}
