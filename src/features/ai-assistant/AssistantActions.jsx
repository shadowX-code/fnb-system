import {useEffect,useState} from 'react';
import Drawer from '../../components/ui/Drawer.jsx';
import {assistantCall} from './nativeAssistantService.js';
export default function AssistantActions({sessionId,onClose}){
 const [items,setItems]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[review,setReview]=useState(null);
 async function load(){if(!sessionId)return;const r=await assistantCall('action_list',{session_id:sessionId});setItems(r.intents);}
 useEffect(()=>{let alive=true;if(sessionId)assistantCall('action_list',{session_id:sessionId}).then(r=>{if(alive)setItems(r.intents);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[sessionId]);
 async function act(item,confirm){setBusy(true);setError('');try{await assistantCall(confirm?'action_confirm':'action_cancel',{intent_id:item.id,...confirm?{fingerprint:item.fingerprint}:{}});setReview(null);await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <Drawer title="Pending actions" description="Review the exact draft before confirming. No publishing or approval." onClose={onClose} width="md">
 {error&&<p role="alert">{error}</p>}{!items.length&&<p>No action previews in this conversation.</p>}
 {items.map(item=><section key={item.id} className="space-y-3 border-b border-border py-4"><h3 className="font-semibold">{item.arguments.title}</h3><p className="whitespace-pre-wrap text-sm">{item.arguments.caption}</p><p className="text-xs text-text-secondary">Brand {item.arguments.brand_id} · {item.state} · Expires {new Date(item.expires_at).toLocaleString()}</p>
 {item.state==='preview'&&<div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={busy} onClick={()=>setReview(item.id)}>Review confirmation</button><button className="btn-ghost" disabled={busy} onClick={()=>act(item,false)}>Cancel</button></div>}
 {review===item.id&&<div role="group" aria-label="Confirm draft creation"><p>Create this text-only Facebook draft in the shown brand? It will not be scheduled or published.</p><button className="btn-primary" disabled={busy} onClick={()=>act(item,true)}>Confirm create draft</button></div>}
 {item.state==='executed'&&<p role="status">Draft created. Review it in Content Calendar.</p>}
 </section>)}
 </Drawer>;
}
