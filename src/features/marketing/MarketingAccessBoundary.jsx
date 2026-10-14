import {Fragment,useEffect,useRef,useState} from 'react';
import {marketingService} from './marketingService.js';

// Server checks remain authoritative on every read/write. Revalidate mounted
// views so a revoked scope does not leave previously fetched records visible.
export default function MarketingAccessBoundary({userId,onAccessChanged,children}){
 const [access,setAccess]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const fingerprint=useRef(null),changed=useRef(onAccessChanged);changed.current=onAccessChanged;
 useEffect(()=>{
  let live=true,checking=false;fingerprint.current=null;setAccess(null);setError('');
  async function check(){
   if(checking||!live||document.visibilityState==='hidden')return;checking=true;
   try{const next=await marketingService.accessFingerprint();if(live){if(next!==fingerprint.current){if(fingerprint.current!==null)await changed.current?.();if(!live)return;fingerprint.current=next;setAccess(next)}setError('')}}
   catch{if(live){fingerprint.current=null;setAccess(null);setError('Your Marketing access could not be verified. Reload or ask an administrator to review your access.')}}
   finally{checking=false}
  }
  const invalidate=()=>{setAccess(null);fingerprint.current=null;void check()};
  const focus=()=>{void check()};
  void check();const timer=setInterval(check,15000);
  window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);window.addEventListener('marketing-access-changed',invalidate);
  return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);window.removeEventListener('marketing-access-changed',invalidate)};
 },[userId,retry]);
 if(error)return <div className="card p-5" role="alert"><p>{error}</p><button className="btn-secondary mt-3" onClick={()=>setRetry(v=>v+1)}>Retry Access Check</button></div>;
 if(!access)return <div className="card p-5" role="status">Checking Brand access…</div>;
 return <Fragment key={access}>{children}</Fragment>;
}
