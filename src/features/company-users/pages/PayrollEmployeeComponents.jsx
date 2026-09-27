import { useState } from 'react';
import Modal from '../../../components/feedback/Modal.jsx';
import DataTable from '../../../components/tables/DataTable.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import SelectField from '../../../components/forms/SelectField.jsx';
import DatePickerField from '../../../components/forms/DatePickerField.jsx';
import AdminFormField from '../../../components/forms/AdminFormField.jsx';
import { payrollService } from '../../../services/payrollService.js';

const money = (value) => new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(value);
export function componentTimeline(versions, date) {
  const sorted = [...versions].sort((a,b) => a.effective_from.localeCompare(b.effective_from));
  return { current: sorted.filter(v => v.effective_from <= date).at(-1),
    upcoming: sorted.filter(v => v.effective_from > date), latest: sorted.at(-1), versions: sorted };
}
export function ComponentSummary({ profile, components, date }) {
  const ids = [...new Set((profile.recurring || []).map(v => v.component_id))];
  return <div className="divide-y divide-border">{ids.length ? ids.map(id => {
    const timeline = componentTimeline(profile.recurring.filter(v => v.component_id === id), date);
    return <div key={id} className="py-2 text-sm"><div className="flex justify-between gap-3"><strong>{components.find(c => c.id === id)?.name || 'Component'}</strong><span className="tabular-nums">{timeline.current?.is_active ? money(timeline.current.amount) : 'Stopped / not started'}</span></div>
      {timeline.upcoming.map(v => <p key={v.id} className="text-xs text-text-secondary">{v.is_active ? `${money(v.amount)} from` : 'Stops'} {v.effective_from}</p>)}</div>;
  }) : <p className="text-sm text-text-secondary">No recurring components. Add allowances or deductions through Manage Components.</p>}</div>;
}

export default function PayrollEmployeeComponents({ profile, components, date, onClose, onSaved }) {
  const [selection, setSelection] = useState('');
  const [mode, setMode] = useState('');
  const [draft, setDraft] = useState({ componentId: '', amount: '', effectiveFrom: date, reason: '' });
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const rows = [...new Set((profile.recurring || []).map(v => v.component_id))].map(id => ({
    id, definition: components.find(c => c.id === id), ...componentTimeline(profile.recurring.filter(v => v.component_id === id),date),
  }));
  const selected = rows.find(r => r.id === selection);
  const begin = (action, row) => {
    setMode(action); setError('');
    setDraft({ componentId: row?.id || '', amount: row?.latest?.amount || '', effectiveFrom: date, reason: '' });
  };
  const save = async () => {
    setBusy(true);setError('');
    try {
      await payrollService.adjustRecurring({ ...draft, profileId: profile.id, amount: Number(draft.amount), active: mode !== 'stop' });
      await onSaved(); setMode('');
    } catch(e) { setError(e.message || 'Unable to save component change.'); }
    finally { setBusy(false); }
  };
  const selectedForDraft = rows.find(r => r.id === draft.componentId);
  const allowed = draft.componentId && draft.effectiveFrom && draft.reason.trim()
    && (!selectedForDraft || draft.effectiveFrom > selectedForDraft.latest.effective_from)
    && (mode === 'stop' || Number(draft.amount) > 0);
  if (mode) return <Modal title={{add:'Add Component',change:'Change Amount',stop:'Stop Component'}[mode]} size="lg" onClose={() => setMode('')}
    description="Permanent employee setup. This creates a new effective-dated version; previous payroll evidence is never overwritten."
    footer={<><button className="btn-secondary" disabled={busy} onClick={() => setMode('')}>Back</button><button className="btn-primary" disabled={!allowed || busy} onClick={save}>{busy ? 'Saving…' : mode === 'stop' ? 'Stop Component' : 'Save Change'}</button></>}>
    <div className="space-y-4">{mode === 'add' ? <SelectField label="Pay Component" searchable value={draft.componentId} onChange={componentId => setDraft(v=>({...v,componentId}))}
      options={[{value:'',label:'Select component'},...components.filter(c=>c.is_active && ['allowance','deduction'].includes(c.component_type) && !rows.some(r=>r.id===c.id && r.latest.is_active)).map(c=>({value:c.id,label:c.name}))]} /> : <p className="font-bold">{selectedForDraft?.definition?.name}</p>}
      {mode !== 'stop' && <AdminFormField label="Amount (MYR)" required><input className="control" inputMode="decimal" type="number" min="0.01" step="0.01" value={draft.amount} onChange={e=>setDraft(v=>({...v,amount:e.target.value}))} /></AdminFormField>}
      <DatePickerField label={mode === 'stop' ? 'Effective Stop Date' : 'Effective From'} required value={draft.effectiveFrom} onChange={effectiveFrom=>setDraft(v=>({...v,effectiveFrom}))} />
      {selectedForDraft && <p className="text-sm text-text-secondary">Latest scheduled version: {selectedForDraft.latest.effective_from}. Choose a later date; scheduled changes cannot overlap or be overwritten.</p>}
      <AdminFormField label="Reason" required><input className="control" value={draft.reason} onChange={e=>setDraft(v=>({...v,reason:e.target.value}))} /></AdminFormField>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    </div>
  </Modal>;
  if (selected) return <Modal title={selected.definition?.name || 'Component'} size="lg" onClose={()=>setSelection('')}
    footer={<><button className="btn-secondary" onClick={()=>setSelection('')}>Back</button>{selected.latest.is_active && <><button className="btn-secondary" onClick={()=>begin('stop',selected)}>Stop Component</button><button className="btn-primary" onClick={()=>begin('change',selected)}>Change Amount</button></>}</>}>
    <div className="space-y-4"><p>Current: <strong>{selected.current?.is_active ? money(selected.current.amount) : 'Stopped / not started'}</strong></p>
      {selected.upcoming.length>0 && <section><h3 className="font-bold">Future Changes</h3>{selected.upcoming.map(v=><p key={v.id} className="text-sm">{v.effective_from} · {v.is_active ? money(v.amount) : 'Stop scheduled'}</p>)}</section>}
      <section><h3 className="mb-2 font-bold">Effective-dated History</h3><div className="divide-y divide-border">{[...selected.versions].reverse().map(v=><div key={v.id} className="py-2 text-sm"><strong>{v.effective_from} · {v.is_active ? money(v.amount) : 'Stopped'}</strong><p className="text-text-secondary">{v.reason} · Recorded {v.created_at?.slice(0,10) || '—'}</p></div>)}</div></section></div>
  </Modal>;
  return <Modal title={`Manage Components · ${profile.employee_name}`} size="xl" onClose={onClose}
    description="Recurring allowances and deductions. One-period adjustments belong in the Payroll Run."
    footer={<><button className="btn-secondary" onClick={onClose}>Close</button><button className="btn-primary" onClick={()=>begin('add')}>Add Component</button></>}>
    {rows.length ? <DataTable density="compact" rows={rows} getRowKey={r=>r.id} columns={[
      {key:'name',header:'Component',render:r=><strong>{r.definition?.name || 'Component'}</strong>},
      {key:'type',header:'Type',render:r=>r.definition?.component_type},
      {key:'amount',header:'Current Amount',align:'right',render:r=>r.current?.is_active ? money(r.current.amount) : '—'},
      {key:'from',header:'Effective From',render:r=><>{r.current?.effective_from || 'Not started'}{r.upcoming.length>0 && <small className="block text-text-secondary">Next: {r.upcoming[0].effective_from}</small>}</>},
      {key:'status',header:'Status',render:r=><Badge tone={r.upcoming.length ? 'warning' : r.current?.is_active ? 'success':'neutral'}>{r.upcoming.length ? 'Scheduled change' : r.current?.is_active ? 'Active':'Stopped'}</Badge>},
      {key:'action',header:'Action',render:r=><button className="font-semibold text-primary" onClick={()=>setSelection(r.id)}>View</button>},
    ]} /> : <p className="py-6 text-sm text-text-secondary">No components assigned. Add a canonical allowance or deduction.</p>}
  </Modal>;
}
