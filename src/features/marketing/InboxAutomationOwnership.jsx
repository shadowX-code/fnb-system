import {useState} from 'react';
import SelectField from '../../components/forms/SelectField.jsx';
import Badge from '../../components/ui/Badge.jsx';
export default function InboxAutomationOwnership({connection,can,busy,configure}) {
 const saved=connection.automation||{owner:'unknown',revision:0};
 const [owner,setOwner]=useState(saved.owner),[confirmed,setConfirmed]=useState(false);
 const requiresConfirmation=owner==='feedx';
 return <div className="inbox-automation-owner">
  <header><strong>{connection.account_name} · {connection.channel==='facebook'?'Messenger':'Instagram'}</strong><Badge tone={saved.issue?'warning':'neutral'}>{saved.owner==='feedx'&&!saved.issue?'FeedX owner':saved.owner==='meta'?'External owner':'Automatic replies paused'}</Badge></header>
  {saved.issue==='external_outbound_observed'?<p role="status">An outbound message outside FeedX was observed. Review Meta and other senders before confirming ownership again.</p>:null}
  <SelectField label={`Automation owner · ${connection.account_name}`} value={owner} disabled={!can('configure')||busy} onChange={value=>{setOwner(value);setConfirmed(false)}} options={[{value:'unknown',label:'Unknown — pause FeedX automatic replies'},{value:'meta',label:'Meta / another tool handles automatic replies'},{value:'feedx',label:'FeedX — other automatic replies disabled'}]}/>
  {requiresConfirmation?<label className="marketing-inbox-check"><input type="checkbox" disabled={!can('configure')||busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked this channel at source: Meta FAQ answers, instant/away replies, sent welcome messages and other tools’ automatic replies are off.</label>:null}
  {can('configure')?<button type="button" className="btn-secondary" disabled={busy||owner===saved.owner&&!requiresConfirmation||requiresConfirmation&&(!confirmed||!can('ai')||!can('send'))} onClick={()=>configure('automation_owner',saved.revision,{connection_id:connection.id,generation:connection.credential_generation,owner,native_disabled:confirmed})}>Confirm ownership</button>:null}
 </div>;
}
