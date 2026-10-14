import { contentDay, postMetric, shiftDay } from './contentManagement.js';
export const numberLabel = value => value === null || value === undefined ? '—' : value.toLocaleString('en-MY');
export function latestPosts(observations) {
 const groups = new Map();
 // Resolve historical missing account snapshots only through exact connection/post evidence.
 const accounts=new Map();
 for(const p of observations){const k=JSON.stringify([p.channel,p.connection_id,p.provider_post_id]);if(p.provider_account_id){if(!accounts.has(k))accounts.set(k,new Set());accounts.get(k).add(p.provider_account_id);}}
 for(const p of observations){
  if(!p.provider_post_id || !['facebook','instagram'].includes(p.channel))continue;
  const known=accounts.get(JSON.stringify([p.channel,p.connection_id,p.provider_post_id]));
  const account=p.provider_account_id || (known?.size===1?[...known][0]:`${p.connection_id}:${p.connection_generation}`);
  const key=JSON.stringify([p.channel,account,p.provider_post_id]);
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);
 }
 return [...groups.entries()].map(([key,rows])=>{
  rows.sort((a,b)=>(Date.parse(b.observed_at)||0)-(Date.parse(a.observed_at)||0)||String(b.id).localeCompare(String(a.id)));
  const latest={...rows[0],key,metrics:{},metric_provenance:{},metric_observations:{}};
  for(const name of ['views','viewers','interactions','likes','reactions','comments','shares','saves','reach','watch_time_ms','avg_watch_time_ms']){
   const valid=rows.find(r=>r.connection_id===latest.connection_id&&r.connection_generation===latest.connection_generation&&postMetric(r,name)!==null);
   if(valid){latest.metrics[name]=postMetric(valid,name);latest.metric_observations[name]=valid.metric_observations?.[name]||valid.metric_provenance?.[name]?.observed_at||valid.observed_at;if(valid.metric_provenance?.[name])latest.metric_provenance[name]=valid.metric_provenance[name];}
  }
  return latest;
 });
}
export function metricAggregate(posts,key){
 const values=posts.map(p=>postMetric(p,key)).filter(v=>v!==null);
 const mixed=['views','interactions'].includes(key)&&new Set(posts.map(p=>p.channel)).size>1;
 return {value:mixed||['reach','viewers'].includes(key)?null:values.length?values.reduce((a,b)=>a+b,0):null,available:values.length,total:posts.length,...(mixed?{mixed_definitions:true}:{})};
}
export function socialProjection(observations,from,to,channel=''){
 const posts=latestPosts(observations).filter(p=>p.published_at&&(!channel||p.channel===channel)&&(!from||contentDay(p.published_at)>=from)&&(!to||contentDay(p.published_at)<=to));
 const channels=['facebook','instagram'].map(channel=>{const records=posts.filter(p=>p.channel===channel);return {channel,count:records.length,views:metricAggregate(records,'views'),interactions:metricAggregate(records,'interactions')};});
 return {posts,channels,views:metricAggregate(posts,'views'),interactions:metricAggregate(posts,'interactions')};
}
export function performanceBuckets(posts,from,to,grain='day'){
 const buckets=new Map();
 for(let day=from;day<=to;day=shiftDay(day,1)){
  const date=new Date(day+'T12:00:00Z');const key=grain==='month'?day.slice(0,7):grain==='week'?shiftDay(day,-((date.getUTCDay()+6)%7)):day;
  if(!buckets.has(key))buckets.set(key,[]);
 }
 for(const p of posts){const day=contentDay(p.published_at),date=new Date(day+'T12:00:00Z');const key=grain==='month'?day.slice(0,7):grain==='week'?shiftDay(day,-((date.getUTCDay()+6)%7)):day;buckets.get(key)?.push(p);}
 return [...buckets].map(([date,records])=>({date,published:records.length,views:metricAggregate(records,'views').value,interactions:metricAggregate(records,'interactions').value,channels:Object.fromEntries(['facebook','instagram'].map(channel=>{const rows=records.filter(p=>p.channel===channel);return [channel,{count:rows.length,views:metricAggregate(rows,'views'),interactions:metricAggregate(rows,'interactions')}]}))}));
}
export function operationProjection({tasks=null,content=null,conversations=null},brands,today,month){
 const weekStart=shiftDay(today,-((new Date(today+'T12:00:00Z').getUTCDay()+6)%7)),weekEnd=shiftDay(weekStart,6);
 const due=tasks?.filter(t=>t.status!=='completed'&&t.due_date&&t.due_date<=weekEnd)||[];
 const reviews=[...(tasks?.filter(t=>t.status==='in_review')||[]).map(t=>({kind:'task',record:t})),...(content?.filter(c=>c.status==='review')||[]).map(c=>({kind:'content',record:c}))];
 const issues=content?.filter(c=>c.status==='failed'||c.channels?.some(v=>v.job_state==='failed'||v.job_state==='blocked'||v.job_state==='reconciling'||v.status==='failed'))||[];
 const replies=conversations?.filter(c=>c.needs_reply&&c.status!=='resolved'&&c.channel!=='internal')||[];
 const actions=[...issues.map(c=>({key:'issue:'+c.key,kind:'content',record:c,label:'Publishing needs attention',reason:c.channels?.some(v=>v.job_state==='reconciling')?'Checking publication outcome':c.channels?.some(v=>v.job_state==='blocked')?'Publishing is blocked':'Publication failed',urgency:0})),...reviews.map(r=>({...r,key:'review:'+r.record.id,label:r.kind==='task'?'Creative review pending':'Content approval pending',reason:'Awaiting review',urgency:2})),...replies.map(c=>({key:'reply:'+c.id,kind:'conversation',record:c,label:'Customer reply needed',reason:c.latest_message||'New customer message',urgency:c.priority==='urgent'?0:1})),...[...(tasks?.filter(t=>t.blocked&&t.status!=='completed')||[]),...due].map(t=>({key:'due:'+t.id,kind:'task',record:t,label:t.blocked?'Production blocked':t.due_date<today?'Production overdue':'Production deadline',reason:t.blocked?t.blocker_reason:`Due ${t.due_date}`,urgency:t.blocked||t.due_date<today?1:3}))].sort((a,b)=>a.urgency-b.urgency||String(a.record.due_date||a.record.updated_at||'').localeCompare(String(b.record.due_date||b.record.updated_at||'')));
 // One pending action per source record, with its most urgent reason.
 const seen=new Set(),unique=actions.filter(a=>{const k=a.kind+':'+(a.record.id||a.record.key);if(seen.has(k))return false;seen.add(k);return true;});
 const brandRows=brands.map(b=>({...b,due:tasks===null?null:due.filter(t=>t.brand_id===b.id).length,reviews:tasks===null||content===null?null:reviews.filter(r=>r.record.brand_id===b.id).length,issues:content===null?null:issues.filter(c=>c.brand_id===b.id).length,replies:conversations===null?null:replies.filter(c=>c.brand_id===b.id).length}));
 const publishing=content?.filter(c=>c.status!=='published'&&c.status!=='cancelled'&&[c.scheduled_at,c.planned_at].some(value=>value&&contentDay(value)>=weekStart&&contentDay(value)<=weekEnd))||[];
 return {due,reviews,issues,replies,actions:unique,brandRows,weekStart,weekEnd,month,week:{production:tasks===null?null:tasks.filter(t=>t.status!=='completed'&&t.due_date>=weekStart&&t.due_date<=weekEnd).length,publishing:content===null?null:publishing.length,reviews:tasks===null||content===null?null:reviews.length,blocked:tasks===null?null:tasks.filter(t=>t.blocked&&t.status!=='completed').length}};
}

// Canonical snapshot projection already owns aggregation/pairing; presentation only selects series.
export function observationBuckets(performance,metric,basis){
 const rows=performance?.rows||[],lookup=new Map(rows.map(r=>[JSON.stringify([r.ending,r.channel,r.metric]),r]));
 return [...new Set(rows.map(r=>r.ending))].sort().map(date=>({date,channels:Object.fromEntries(['facebook','instagram'].map(channel=>{
  const r=lookup.get(JSON.stringify([date,channel,metric]));
  return [channel,{value:basis==='growth'?r?.growth??null:r?.cumulative??null,available:basis==='growth'?r?.paired_posts||0:r?.available_posts||0,total:r?.observed_posts||0,cohort:basis==='cumulative'?r?.cohort:null,starting:r?.starting,ending:r?.ending,last_observed_at:r?.last_observed_at}];
 }))}));
}
export function rankSocialPosts(posts,metric,channel){
 // Cross-platform metrics have different definitions; rank each channel independently.
 return posts.filter(p=>(!channel||p.channel===channel)&&postMetric(p,metric)!==null).sort((a,b)=>postMetric(b,metric)-postMetric(a,metric)||String(b.published_at).localeCompare(String(a.published_at))||a.key.localeCompare(b.key));
}
