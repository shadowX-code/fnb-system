import { useEffect, useRef, useState } from 'react';
import { Check, Clock3, MessageSquare, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import Drawer from '../../components/ui/Drawer.jsx';
import { assistantCall } from './nativeAssistantService.js';

export function HistoryDrawer({ close, thread, locked, act, rename }) {
 const [query,setQuery]=useState(''),[page,setPage]=useState({sessions:[]}),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[intent,setIntent]=useState(null),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 const request=useRef(null);
 useEffect(()=>{
  const controller=new AbortController();request.current=controller;
  setLoading(true);setError('');
  const timer=setTimeout(()=>assistantCall('session_list',{query:query.trim()},controller.signal)
   .then(result=>{if(!controller.signal.aborted)setPage(result);})
   .catch(error=>{if(!controller.signal.aborted){setError(error.message);setPage({sessions:[]});}})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);}),query?170:0);
  return ()=>{clearTimeout(timer);controller.abort();request.current?.abort();};
 },[query,reload,thread?.title]);
 async function more(){
  const tail=page.sessions.at(-1);if(!tail||loading)return;
  request.current?.abort();const controller=new AbortController();request.current=controller;
  setLoading(true);setError('');
  try{
   const next=await assistantCall('session_list',{query:query.trim(),before_activity:tail.last_activity_at,before_id:tail.id},controller.signal);
   if(!controller.signal.aborted)setPage(p=>({sessions:[...p.sessions,...next.sessions.filter(s=>!p.sessions.some(x=>x.id===s.id))],has_more:next.has_more}));
  }catch(cause){if(!controller.signal.aborted)setError(cause.message);}
  finally{if(!controller.signal.aborted)setLoading(false);}
 }
 async function run(action,id,title){
  setBusy(true);setError('');
  try{
   if(action==='rename')await rename(id,title);
   else await act(action,id);
   if(action==='history'||action==='new')close();
   else {setIntent(null);setReload(n=>n+1);}
  }catch(cause){setError(cause.message);}
  finally{setBusy(false);}
 }
 return <Drawer title="Conversation history" description="Private to your FeedX account." width="sm" onClose={close} className="assistant-drawer">
  {locked&&<p className="assistant-drawer-note" role="status">End voice before opening, creating, or deleting a conversation.</p>}
  <div className="assistant-history-tools"><label className="assistant-search"><Search size={16}/><input type="search" aria-label="Search conversation titles" placeholder="Search titles…" value={query} maxLength={80} onChange={e=>{setQuery(e.target.value);setIntent(null);}}/></label>
   <button type="button" className="btn-secondary" disabled={locked||busy} onClick={()=>run('new')}><Plus size={16}/> New</button></div>
  {error&&<p role="alert" className="assistant-drawer-error">{error}</p>}
  {loading&&!page.sessions.length&&<p role="status" className="assistant-drawer-note">Loading conversations…</p>}
  {!loading&&!page.sessions.length&&!error&&<p className="assistant-drawer-note">{query?'No titles match your search.':'No saved conversations yet. Start a new conversation to begin.'}</p>}
  <ul className="assistant-history-list" aria-busy={loading}>
   {page.sessions.map(item=><li key={item.id} data-selected={thread?.id===item.id}>
    <div className="assistant-history-row">
     <button type="button" className="assistant-history-open" disabled={locked||busy} aria-current={thread?.id===item.id?'true':undefined} onClick={()=>item.id===thread?.id?close():run('history',item.id)}>
      {thread?.id===item.id?<Check size={17}/>:<MessageSquare size={17}/>}
      <span><strong title={item.title}>{item.title}</strong>{item.last_activity_at&&<small><Clock3 size={12}/>{new Date(item.last_activity_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})}</small>}</span>
     </button>
     <button type="button" className="icon-btn" aria-label={'Rename '+item.title} disabled={busy} onClick={()=>setIntent({action:'rename',id:item.id,title:item.title})}><Pencil size={15}/></button>
     <button type="button" className="icon-btn" aria-label={'Delete '+item.title} disabled={locked||busy} onClick={()=>setIntent({action:'delete',id:item.id,title:item.title})}><Trash2 size={15}/></button>
    </div>
    {intent?.id===item.id&&<form className="assistant-history-edit" onSubmit={e=>{e.preventDefault();void run(intent.action,item.id,intent.title);}}>
     {intent.action==='rename'?<label>Conversation title<input required maxLength={80} value={intent.title} onChange={e=>setIntent({...intent,title:e.target.value})}/></label>:
      <p>Remove this conversation from your history? Its messages will be deleted. Factory evidence and audit records are retained by FeedX and won’t be visible in the Assistant.</p>}
     <div><button type="button" className="btn-secondary" onClick={()=>setIntent(null)}>Cancel</button>
      <button type="submit" className={intent.action==='delete'?'btn-secondary assistant-danger':'btn-primary'} disabled={busy||(intent.action==='delete'&&locked)}>{intent.action==='delete'?'Delete conversation':'Save title'}</button></div>
    </form>}
   </li>)}
  </ul>
  {page.has_more&&<button type="button" className="btn-secondary assistant-load-more" disabled={loading||busy} onClick={more}>{loading?'Loading…':'More conversations'}</button>}
 </Drawer>;
}
const fields=[
 ['language','Language preference',{english:'English',mandarin:'Mandarin',malay:'Malay',mixed:'Malaysian mixed-language'}],
 ['reply_style','Response style',{concise:'Concise',detailed:'Detailed',steps:'Step by step'}],
 ['work_preference','Recurring work preference',{exceptions_first:'Lead with exceptions',sources_first:'Lead with sources',next_steps:'Lead with next steps'}],
];
export function MemoryDrawer({close,voiceActive}){
 const [memory,setMemory]=useState(null),[usage,setUsage]=useState(null),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const pending=useRef(null);
 useEffect(()=>{
  const controller=new AbortController();
  assistantCall('memory_get',{},controller.signal).then(r=>{if(!controller.signal.aborted)setMemory(r.memory);}).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);});
  assistantCall('storage_usage',{},controller.signal).then(r=>{if(!controller.signal.aborted)setUsage(r);}).catch(()=>{});
  return ()=>{controller.abort();pending.current?.abort();};
 },[]);
 async function save(remove=false){
  setBusy(true);setNotice('');setError('');const controller=new AbortController();pending.current=controller;
  try{
   const payload={enabled:memory.enabled,...Object.fromEntries(fields.map(([key])=>[key,memory[key]||null]))};
   const result=await assistantCall(remove?'memory_delete':'memory_save',remove?{}:payload,controller.signal);
   if(!controller.signal.aborted){setMemory(result.memory);setConfirm(false);setNotice(remove?'Personal memory deleted.':'Personal memory saved.');}
  }catch(cause){if(!controller.signal.aborted)setError(cause.message);}
  finally{if(!controller.signal.aborted)setBusy(false);}
 }
 return <Drawer title="Personal memory" description="Choose what the Assistant remembers about how you work." width="sm" onClose={close} className="assistant-drawer">
  <p className="assistant-drawer-note">Only the preferences you save here are remembered. They apply to new text replies and voice sessions. They don’t change access to company information.</p>
  {voiceActive&&<p className="assistant-drawer-note">The current voice session keeps the preferences it started with.</p>}
  {error&&<p role="alert" className="assistant-drawer-error">{error}</p>}
  {notice&&<p role="status" className="assistant-drawer-note">{notice}</p>}
  {!memory&&!error&&<p role="status">Loading preferences…</p>}
  {memory&&<form className="assistant-memory-form" onSubmit={e=>{e.preventDefault();void save();}}>
   <label className="assistant-memory-toggle"><input type="checkbox" checked={memory.enabled} onChange={e=>setMemory({...memory,enabled:e.target.checked})}/> Use my saved preferences</label>
   {fields.map(([key,label,options])=><label key={key}>{label}<select value={memory[key]||''} onChange={e=>setMemory({...memory,[key]:e.target.value})}><option value="">No preference</option>{Object.entries(options).map(([value,copy])=><option key={value} value={value}>{copy}</option>)}</select></label>)}
   <div className="assistant-memory-actions"><button type="submit" className="btn-primary" disabled={busy}>Save preferences</button>
    {memory.updated_at&&<button type="button" className="btn-secondary assistant-danger" disabled={busy} onClick={()=>setConfirm(true)}>Delete saved memory</button>}</div>
   {confirm&&<div className="assistant-history-edit"><p>Delete all saved preferences? Your conversations will remain.</p><div><button type="button" className="btn-secondary" onClick={()=>setConfirm(false)}>Cancel</button><button type="button" className="btn-secondary assistant-danger" disabled={busy} onClick={()=>save(true)}>Delete memory</button></div></div>}
  </form>}
  {usage&&<details className="assistant-storage"><summary>Conversation storage</summary>
   <p>{usage.turns} turns · {Math.ceil(usage.content_bytes/1024)} KB of message content · {Math.ceil(usage.evidence_bytes/1024)} KB of evidence</p>
   <p>Storage is measured separately from model usage.</p></details>}
 </Drawer>;
}
