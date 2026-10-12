import { useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Merge, Trash2, ArrowLeft } from 'lucide-react';
import Modal from '../../components/feedback/Modal.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import EmptyState from '../../components/feedback/EmptyState.jsx';
import { outreachService } from './outreachService.js';

export default function CustomerTagsDialog({org, brand, onClose, onChanged}) {
 const [tags,setTags]=useState([]),[search,setSearch]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[mode,setMode]=useState(''),[selected,setSelected]=useState(null),[name,setName]=useState(''),[target,setTarget]=useState(''),[confirmed,setConfirmed]=useState(false),[reload,setReload]=useState(0);
 const intent=useRef(null);
 useEffect(()=>{let live=true;setLoading(true);outreachService.read(org,brand).then(data=>{if(live){setTags(data.tag_catalog||[]);setError('');}}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[org,brand,reload]);
 const choose=(action,tag=null)=>{setMode(action);setSelected(tag);setName(tag?.name||'');setTarget('');setConfirmed(false);setError('');intent.current=null;};
 const impact=selected&&(selected.usage_count>0||selected.audience_count>0)&&['merge','delete'].includes(mode);
 async function save(){
  const destination=tags.find(t=>t.id===target);
  const payload={action:`tag_${mode}`,name:name.trim(),...(selected?{id:selected.id,revision:selected.revision,impact_token:selected.impact_token}:{}),...(mode==='merge'?{target_id:target,target_revision:destination?.revision}:{}),confirmed};
  const fingerprint=JSON.stringify(payload);if(intent.current?.fingerprint!==fingerprint)intent.current={fingerprint,request:crypto.randomUUID()};
  setBusy(true);setError('');
  try{await outreachService.customer(intent.current.request,org,brand,payload);choose('');setReload(v=>v+1);onChanged?.();}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <Modal title="Manage Tags" size="md" onClose={()=>{if(!busy)onClose();}} footer={mode?<><button className="btn-secondary" disabled={busy} onClick={()=>choose('')}><ArrowLeft size={14}/> Back</button><button className="btn-primary" disabled={busy||(mode==='merge'?!target:mode!=='delete'&&!name.trim())||(impact&&!confirmed)} onClick={save}>{busy?'Saving…':mode==='delete'?'Remove tag':mode==='merge'?'Merge tags':'Save tag'}</button></>:<button className="btn-secondary" onClick={onClose}>Done</button>}>
  {error?<p role="alert" className="mb-3 text-danger">{error}</p>:null}
  {mode?<div className="space-y-3">
   {mode==='create'||mode==='rename'?<label className="admin-form-field"><span className="admin-form-field-label">Tag name</span><input className="control" value={name} maxLength={60} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&name.trim()&&!busy){e.preventDefault();save();}}}/></label>:<p>{mode==='merge'?'Merge':'Remove'} <strong>{selected.name}</strong></p>}
   {mode==='merge'?<SelectField label="Merge into" searchable="auto" value={target} onChange={setTarget} options={tags.filter(t=>t.id!==selected.id).map(t=>({value:t.id,label:t.name}))} placeholder="Select destination tag"/>:null}
   {mode==='rename'?<p className="text-sm text-text-secondary">Customer assignments are preserved. Historical audience labels remain available.</p>:null}
   {impact?<><p className="text-sm text-text-secondary">{selected.usage_count} customer{selected.usage_count===1?'':'s'} and {selected.audience_count} audience definition{selected.audience_count===1?'':'s'} use this tag. {mode==='merge'?'Assignments move to the destination tag.':'Assignments are removed.'} Affected unqueued campaigns need review again; queued recipients and historical records stay intact.</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="admin-checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I confirm this impact</label></>:null}
  </div>:<>
   <div className="mb-3 flex flex-wrap items-end gap-2"><div className="min-w-0 flex-1"><AdminSearchField label="Search tags" ariaLabel="Search tags" value={search} onChange={setSearch}/></div><button className="btn-primary" onClick={()=>choose('create')}><Plus size={14}/> New tag</button></div>
   <AsyncDataSurface loading={loading} error={!tags.length?error:''} hasData={tags.length>0}>{tags.filter(t=>t.name.toLowerCase().includes(search.trim().toLowerCase())).length?<DataTable density="compact" minWidth={0} rows={tags.filter(t=>t.name.toLowerCase().includes(search.trim().toLowerCase()))} getRowKey={t=>t.id} columns={[
    {key:'name',header:'Tag',className:'break-all'}, {key:'usage_count',header:'Customers'}, {key:'actions',header:'Actions',render:t=><div className="flex gap-1"><button className="icon-btn" aria-label={`Rename ${t.name}`} onClick={()=>choose('rename',t)}><Pencil size={14}/></button><button className="icon-btn" aria-label={`Merge ${t.name}`} disabled={tags.length<2} onClick={()=>choose('merge',t)}><Merge size={14}/></button><button className="icon-btn" aria-label={`Remove ${t.name}`} onClick={()=>choose('delete',t)}><Trash2 size={14}/></button></div>}
   ]}/>:<EmptyState title={search?'No matching tags':'No tags yet'} description="Create reusable tags for this brand’s customers."/>}</AsyncDataSurface>
  </>}
 </Modal>;
}
