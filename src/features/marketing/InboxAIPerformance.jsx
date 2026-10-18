import {useEffect,useState} from 'react';
import SelectField from '../../components/forms/SelectField.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import {inboxService} from './inboxService.js';
const number=v=>v==null?'Unavailable':Number(v).toLocaleString();
export default function InboxAIPerformance({brand}) {
 const [days,setDays]=useState(7),[read,setRead]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let live=true;setRead(null);setLoading(true);setError('');inboxService.aiPerformance(brand,days).then(r=>{if(live)setRead(r)}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[brand,days,refresh]);
 const g=read?.generation||{},a=read?.automatic||{},d=read?.delivery||{},f=read?.feedback||{};
 return <section aria-label="AI performance"><div className="inbox-ai-performance-heading"><SelectField label="Reporting period" value={String(days)} onChange={v=>setDays(Number(v))} options={[{value:'7',label:'Last 7 days'},{value:'30',label:'Last 30 days'}]}/><button className="btn-secondary" disabled={loading} onClick={()=>setRefresh(x=>x+1)}>Refresh performance</button></div>
  <AsyncDataSurface loading={loading} error={error} hasData={Boolean(read)} onRetry={()=>setRefresh(x=>x+1)}>{read?<><dl className="inbox-ai-performance">{[
   ['Suggestions generated',g.suggestions],['Queued automatic turns',a.queued||0],['Generating',a.generating||0],['Prepared for delivery',a.prepared||0],['Provider accepted',d.provider_accepted],['Delivered',d.delivered],['Read',d.read],['Failed automatic turns',read.failed_automatic??a.failed??0],['Uncertain delivery',d.uncertain],['Human handoffs',read.handoffs],['Helpful feedback',f.helpful],['Feedback responses',f.total],['Input tokens',g.input_tokens],['Output tokens',g.output_tokens],['Average generation (ms)',g.latency_ms==null?null:Math.round(g.latency_ms)],['Estimated cost (USD)',g.estimated_usd==null?null:Number(g.estimated_usd).toFixed(6)]
  ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{typeof value==='string'?value:number(value)}</dd></div>)}</dl><p className="inbox-muted">Generation, provider acceptance, signed delivery and conversation resolution are separate. Handoffs do not mean a conversation is resolved. {g.unknown_cost_requests?`${g.unknown_cost_requests} requests have unavailable billing evidence.`:'Costs are estimates based on returned tokens, not invoices.'}</p></>:null}</AsyncDataSurface>
 </section>;
}
