import {useEffect,useState} from 'react';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {marketingService} from './marketingService.js';

export default function WhatsAppConnections({organizationId,brandId,brands=[]}) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 const scope=`${organizationId}:${brandId||''}`;
 useEffect(()=>{
  const controller=new AbortController();let active=true;
  setData(null);setError('');setLoading(true);
  marketingService.whatsappConnections(organizationId,brandId,controller.signal)
   .then(value=>{if(active)setData({scope,value});})
   .catch(e=>{if(active)setError(e.message);})
   .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;controller.abort();};
 },[organizationId,brandId,scope,refresh]);
 const current=data?.scope===scope?data.value:null;
 return <section className="card p-5" aria-label="WhatsApp Cloud API">
  <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">WhatsApp Cloud API</h2><Badge tone="neutral">Disabled</Badge></div>
  <p className="mt-2 text-sm">WhatsApp onboarding, sending and AI replies are unavailable during foundation verification. Existing manual WhatsApp campaigns are unchanged.</p>
  <AsyncDataSurface loading={loading} error={error} hasData={!!current} onRetry={()=>setRefresh(n=>n+1)}>
   {current?.connections?.length?<ul className="mt-3 space-y-2">{current.connections.map(c=><li key={c.id} className="text-sm"><strong>{c.account_name}</strong> · {brands.find(b=>b.id===c.brand_id)?.name||'Authorized Brand'} · {c.onboarding_mode==='coexistence'?'Business App coexistence':'Cloud API'} · Awaiting verified onboarding</li>)}</ul>:current?<p className="mt-3 text-sm">No WhatsApp Cloud connection registered.</p>:null}
  </AsyncDataSurface>
 </section>;
}
