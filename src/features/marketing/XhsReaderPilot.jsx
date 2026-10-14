import {useEffect,useRef,useState} from 'react';
import Drawer from '../../components/ui/Drawer.jsx';
import {supabase} from '../../lib/supabase';
export default function XhsReaderPilot({org,brand,onClose}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);const running=useRef(false),live=useRef(true);
 async function run(action){
  if(running.current)return;running.current=true;setBusy(true);setError('');
  try{const {data:{session}}=await supabase.auth.getSession();const response=await fetch('/api/marketing-xhs-reader',{method:'POST',headers:{Authorization:'Bearer '+(session?.access_token||''),'Content-Type':'application/json'},body:JSON.stringify({org,brand,action})});const value=await response.json();if(!response.ok)throw new Error(value.error||'Reader unavailable.');if(live.current)setData(current=>({...value,qr_image:value.qr_image||(value.status==='awaiting_login'?current?.qr_image:null)}))}
  catch(e){if(live.current)setError(e.message)}finally{running.current=false;if(live.current)setBusy(false)}
 }
 useEffect(()=>{live.current=true;run('status');return()=>{live.current=false}},[]);
 return <Drawer open title="XHS Reader Pilot" onClose={()=>{if(!busy)onClose()}} width="md" footer={<button className="btn-secondary" disabled={busy} onClick={onClose}>Close</button>}>
  <p className="text-sm text-text-secondary">An isolated, administrator-only Reader. A session login enables reading; it does not grant permission to collect or reuse platform content.</p>
  {error?<p role="alert" className="text-sm text-danger mt-3">{error}</p>:null}
  {data?<p role="status" className="text-sm mt-3">Session: {data.status.replaceAll('_',' ')}</p>:null}
  {data?.qr_image?.startsWith('data:image/png;base64,')?<div className="mt-4"><img src={data.qr_image} alt="XHS login QR code — scan and confirm in your XHS app" className="w-48 h-48 object-contain"/><p className="text-sm text-text-secondary">Expires within three minutes. Confirm login yourself in the XHS app, then check status. FeedX never needs your password.</p></div>:null}
  <div className="flex flex-wrap gap-3 mt-4">
   <button className="btn-primary" disabled={busy||!data?.live_enabled||!data?.session_persistence_enabled} onClick={()=>run('login_start')}>{busy?'Working…':data?.status==='disconnected'?'Show Login QR':'Reconnect with QR'}</button>
   <button className="btn-secondary" disabled={busy||!data} onClick={()=>run(data?.status==='awaiting_login'?'login_check':'status')}>Check Status</button>
   <button className="btn-secondary" disabled={busy||!data||data.status==='disconnected'} onClick={()=>run('disconnect')}>Disconnect</button>
  </div>
  {!data?.live_enabled?<p className="text-sm text-text-secondary mt-4">Live login is disabled until platform-use review, session storage approval and the isolated host are confirmed.</p>:null}
 </Drawer>;
}
