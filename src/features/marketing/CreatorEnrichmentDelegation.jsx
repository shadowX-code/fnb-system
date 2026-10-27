import {useEffect,useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {useAuth} from '../../auth/AuthContext.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ConfirmDialog from '../../components/feedback/ConfirmDialog.jsx';
import {creatorService} from './creatorService.js';

export default function CreatorEnrichmentDelegation({org}){
 const auth=useAuth(),allowed=auth.hasPermission('platform_organizations.manage')&&auth.hasPermission('marketing_creators.manage');
 const key=org+':'+auth.user?.id,scope=useRef(key);scope.current=key;
 const [read,setRead]=useState(null),[selected,setSelected]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0),[confirm,setConfirm]=useState(null);
 const running=useRef(false),request=useRef(null);
 useEffect(()=>{
  if(!allowed||!org)return;
  let live=true;setRead(null);setError('');setNotice('');setConfirm(null);setSelected('');
  creatorService.enrichmentSettings(org).then(data=>{if(live){setRead({key,data});setSelected(data.connection_id||'')}}).catch(e=>{if(live)setError(e.message)});
  return()=>{live=false};
 },[key,allowed,reload]);
 const data=read?.key===key?read.data:null,connections=data?.connections||[],connection=connections.find(c=>c.id===selected);
 const unchanged=data?.active&&data.eligible&&connection?.id===data.connection_id&&connection.generation===data.generation;
 async function save(active){
  if(running.current||!data||active&&!connection)return;
  const start=scope.current,intent={org,revision:data.revision,connection:active?connection.id:null,generation:active?connection.generation:null,active},fingerprint=JSON.stringify(intent);
  if(request.current?.fingerprint!==fingerprint)request.current={fingerprint,id:crypto.randomUUID()};
  running.current=true;setBusy(true);setConfirm(null);setError('');setNotice('');
  try{const next=await creatorService.delegateEnrichment({...intent,request:request.current.id});if(scope.current===start){setRead({key:start,data:next});setSelected(next.connection_id||'');const applied=active?next.active&&next.eligible&&next.connection_id===intent.connection&&next.generation===intent.generation:!next.active;setNotice(applied?(active?'Public Creator reads delegated.':'Delegation revoked. Saved Creator information is retained.'):'Delegation changed. Review the current status before continuing.');request.current=null}}
  catch(e){if(scope.current===start)setError(e.message)}
  finally{running.current=false;if(scope.current===start)setBusy(false)}
 }
 if(!allowed||!org)return null;
 return <section className="card p-4 space-y-3" aria-labelledby="creator-enrichment-title">
  <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 id="creator-enrichment-title" className="font-semibold">Creator profile enrichment</h2><p className="text-sm text-text-secondary">Workspace-wide · public Instagram profiles, photos and followers.</p></div><div className="flex items-center gap-2"><Badge tone={data?.eligible?'success':'neutral'}>{!data?(error?'Unavailable':'Loading…'):data.eligible?'Delegated':data.active?'Connection changed · paused':'Not delegated'}</Badge><button type="button" className="icon-btn" aria-label="Reload Creator delegation" disabled={busy} onClick={()=>setReload(v=>v+1)}><RefreshCw size={16}/></button></div></div>
  {data?<><SelectField label="Instagram connection for public Creator reads" value={selected} onChange={setSelected} disabled={busy} searchable="auto" options={[{value:'',label:'Choose a connection'},...(selected&&!connections.some(c=>c.id===selected)?[{value:selected,label:'Previously delegated connection · unavailable',disabled:true}]:[]),...connections.map(c=>({value:c.id,label:`@${c.account_name} · ${c.brand} · version ${c.generation}`}))]}/>
   {!connections.length?<p className="text-sm text-text-secondary">No eligible Instagram connection is available within your account permissions.</p>:null}
   <p className="text-sm text-text-secondary">Delegation allows public Creator reads only. Private Brand data and messaging, publishing and Ads permissions are unchanged. Reconnecting the source requires fresh delegation.</p>
   <div className="flex flex-wrap justify-end gap-2">{data.active?<button type="button" className="btn-secondary" disabled={busy} onClick={()=>setConfirm({active:false,title:'Revoke public Creator reads?',message:'Stop new refreshes and reject unfinished results. Existing photos, follower observations and history are retained.',confirmLabel:'Revoke delegation',danger:true})}>Revoke delegation</button>:null}<button type="button" className="btn-primary" disabled={busy||!connection||unchanged} onClick={()=>setConfirm({active:true,title:'Delegate public Creator reads?',message:`Allow this workspace to refresh public Creator profiles, photos and follower counts through @${connection.account_name} (connection version ${connection.generation})?`,confirmLabel:'Delegate public reads'})}>{busy?'Saving…':data.active?'Update delegation':'Delegate public reads'}</button></div>
  </>:null}
  {error?<p role="alert" className="text-sm text-danger">{error}</p>:null}{notice?<p role="status" className="text-sm text-success">{notice}</p>:null}
  <ConfirmDialog request={confirm} onCancel={()=>setConfirm(null)} onConfirm={()=>save(confirm.active)}/>
 </section>;
}
