import {useState} from 'react';
import Modal from '../../components/feedback/Modal.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import Badge from '../../components/ui/Badge.jsx';
import EmptyState from '../../components/feedback/EmptyState.jsx';
import {normalizeMalaysianPhone} from './whatsappDelivery.js';

export default function WhatsAppSenderDialog({brandName,senders,canManage,busy,error,onClose,onCommand}) {
 const [form,setForm]=useState(null),[localError,setLocalError]=useState('');
 async function save(){
  setLocalError('');
  try{
   const phone=normalizeMalaysianPhone(form.phone);
   const result=await onCommand(form.id?'sender_edit':'sender',form.id||null,{label:form.label.trim(),phone,...(form.id?{revision:form.revision}:{})});
   if(result)setForm(null);
  }catch(e){setLocalError(e.message)}
 }
 const input=(label,key,type='text')=><AdminFormField label={label}><input className="control" type={type} value={form[key]} maxLength={key==='label'?160:30} placeholder={key==='phone'?'+60 12 345 6789':undefined} disabled={busy} onChange={event=>setForm({...form,[key]:event.target.value})}/></AdminFormField>;
 return <Modal title={form?(form.id?'Edit WhatsApp Sender':'Add WhatsApp Sender'):'WhatsApp Senders'} size="md" onClose={onClose} footer={form?<><button className="btn-secondary" disabled={busy} onClick={()=>{setForm(null);setLocalError('')}}>Cancel</button><button className="btn-primary" disabled={busy||!form.label.trim()||!form.phone.trim()} onClick={save}>{form.id?'Save Changes':'Add Sender'}</button></>:<button className="btn-secondary" disabled={busy} onClick={onClose}>Done</button>}>
  <div className="space-y-4">
   {localError||error?<p role="alert" className="text-danger">{localError||error}</p>:null}
   {form?<div className="outreach-form-grid">{input('Sender Name','label')}{input('WhatsApp Number','phone','tel')}</div>:<>
    {canManage?<button className="btn-primary" disabled={busy} onClick={()=>{setLocalError('');setForm({label:brandName,phone:''})}}>Add WhatsApp Sender</button>:null}
    {senders.length?<ul className="divide-y divide-border">{senders.map(sender=><li key={sender.id} className="py-3 space-y-2">
     <div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{sender.label}</strong>{sender.is_default?<Badge tone="success">Default</Badge>:null}<Badge tone={sender.active?'success':'default'}>{sender.active?'Available':'Disabled'}</Badge></div>
     <p className="text-sm text-text-secondary">{sender.phone_e164}</p>
     {canManage?<div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={busy} onClick={()=>{setLocalError('');setForm({id:sender.id,label:sender.label,phone:sender.phone_e164,revision:sender.revision})}}>Edit</button>{sender.active?<><button className="btn-secondary" disabled={busy||sender.is_default} onClick={()=>onCommand('sender_default',sender.id,{revision:sender.revision})}>Set Default</button><button className="btn-secondary" disabled={busy} onClick={()=>onCommand('sender_disable',sender.id,{revision:sender.revision})}>Disable</button></>:null}</div>:null}
    </li>)}</ul>:<EmptyState title="No WhatsApp senders" description="Add a number your staff use for this brand."/>}
    <p className="text-sm text-text-secondary">These are manual sender registrations. Adding a number does not connect WhatsApp or verify its login.</p>
   </>}
  </div>
 </Modal>;
}
