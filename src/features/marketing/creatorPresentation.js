export const creatorPlatforms=[{value:'facebook',label:'Facebook'},{value:'instagram',label:'Instagram'},{value:'xhs',label:'Xiaohongshu'},{value:'tiktok',label:'TikTok'}];
export const collaborationStates=['planned','in_progress','published','completed'];
export const contentTypes=[{value:'video',label:'Reels / Video'},{value:'image',label:'Picture / Carousel'}];
export const isPublishedPost=p=>Boolean(p.canonical_url&&(p.published_at||p.published_date||p.publication_confirmed_at));
// One row per canonical Post; a planned entry without Posts remains one row.
export function collaborationPublishing(c,posts){
 const related=c.id?posts.filter(p=>p.collaboration_id===c.id):[],used=new Set(),entries=[];
 for(const [index,plan] of (c.deliverables||[]).entries()){
  if(plan.status==='cancelled')continue;
  const linked=plan.id?related.filter(p=>p.deliverable_id===plan.id):[];
  if(!linked.length)entries.push({key:plan.id||`planned-${index}`,plan,post:null,platform:plan.platform,content_type:plan.content_type,published:false});
  for(const post of linked){used.add(post.id);entries.push({key:post.id,plan,post,platform:post.platform,content_type:post.content_type||plan.content_type,published:isPublishedPost(post)});}
 }
 for(const post of related)if(!used.has(post.id))entries.push({key:post.id,plan:null,post,platform:post.platform,content_type:post.content_type,published:isPublishedPost(post)});
 return entries;
}
export function publishingProgress(c,posts){const entries=collaborationPublishing(c,posts),published=entries.filter(e=>e.published).length;return {published,total:entries.length,text:entries.length?`${published}/${entries.length} Published`:'No publishing entries'};}
export const deliverableStates=['pending','submitted','completed','cancelled'];
export const label=value=>({in_progress:'In Progress',recorded:'Actual'})[value]||creatorPlatforms.find(p=>p.value===value)?.label||String(value||'').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
export const metricKeys=['views','reach','interactions','likes','comments','shares','saves'];
export const metricLabel=k=>label(k);
export const number=v=>typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat('en-MY').format(v):'—';
export const day=value=>value?new Intl.DateTimeFormat('en-MY',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(value.length===10?value+'T12:00:00+08:00':value)):'Not set';
export const stamp=value=>value?new Intl.DateTimeFormat('en-MY',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(value)):'Not set';
export const money=(value,currency)=>new Intl.NumberFormat('en-MY',{style:'currency',currency}).format(Number(value||0));
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function metricTotal(posts,key){if(key==='reach')return {value:null,available:0,total:posts.length};const values=posts.map(p=>p.latest_metrics?.[key]).filter(v=>typeof v==='number');return {value:values.length?values.reduce((a,b)=>a+b,0):null,available:values.length,total:posts.length};}
export function creatorInsights(data,from='',to=''){
 const inRange=value=>{if(!value)return !from&&!to;const d=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));return (!from||d>=from)&&(!to||d<=to)};
 const collaborations=data.collaborations.filter(c=>inRange(c.visit_at||c.created_at));
 const ids=new Set(collaborations.map(c=>c.id));
 const posts=data.posts.filter(p=>p.collaboration_id?ids.has(p.collaboration_id):inRange(p.published_at||p.published_date||p.created_at));
 const costs=collaborations.filter(c=>c.cost_state==='recorded'||c.status!=='cancelled').reduce((rows,c)=>{const key=c.currency+'|'+c.cost_state;const v=rows.get(key)||{currency:c.currency,state:c.cost_state,cash:0,inKind:0};v.cash+=Number(c.cash_cost);v.inKind+=Number(c.in_kind_cost);rows.set(key,v);return rows},new Map());
 const deliverables=collaborations.filter(c=>c.status!=='cancelled').flatMap(c=>c.deliverables).filter(d=>d.status!=='cancelled');
 const comparison=[...new Set([...collaborations.map(c=>c.brand_id),...posts.map(p=>p.brand_id)])].map(brand=>{const cs=collaborations.filter(c=>c.brand_id===brand),ci=new Set(cs.map(c=>c.id)),ps=posts.filter(p=>p.brand_id===brand);return {brand,collaborations:cs.length,posts:ps.length,interactions:metricTotal(ps,'interactions'),completed:cs.flatMap(c=>c.deliverables).filter(d=>d.status==='completed').length,deliverables:cs.flatMap(c=>c.deliverables).filter(d=>d.status!=='cancelled').length,recordedCosts:[...cs.filter(c=>c.cost_state==='recorded').reduce((totals,c)=>totals.set(c.currency,(totals.get(c.currency)||0)+Number(c.cash_cost)),new Map())].map(([currency,value])=>({currency,value}))}});
 const outlets=[...new Set([...collaborations.map(c=>c.outlet_id||''),...posts.map(p=>p.outlet_id||collaborations.find(c=>c.id===p.collaboration_id)?.outlet_id||'')])].map(outlet=>{const cs=collaborations.filter(c=>(c.outlet_id||'')===outlet),ci=new Set(cs.map(c=>c.id)),ps=posts.filter(p=>(p.outlet_id||collaborations.find(c=>c.id===p.collaboration_id)?.outlet_id||'')===outlet);return {outlet,collaborations:cs.length,posts:ps.length,interactions:metricTotal(ps,'interactions')}});
 return {collaborations,posts,costs:[...costs.values()],deliverables,completed:deliverables.filter(d=>d.status==='completed').length,interactions:metricTotal(posts,'interactions'),comparison,outlets};
}
export function creatorFollowups(data,date=today()){
 const rows=[];
 for(const c of data.collaborations){if(c.status==='cancelled')continue;
 if(c.visit_at&&['planned','confirmed'].includes(c.status)){const d=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(c.visit_at));if(d<=date||new Date(d+'T12:00Z')-new Date(date+'T12:00Z')<=7*86400000)rows.push({kind:'collaboration',id:c.id,brand_id:c.brand_id,title:c.title,reason:d<date?'Visit follow-up overdue':'Upcoming visit',date:d});}
 if(c.status!=='completed'&&c.follow_up_date&&c.follow_up_date<=date)rows.push({kind:'collaboration',id:c.id,brand_id:c.brand_id,title:c.title,reason:'Follow-up due',date:c.follow_up_date});
 for(const d of c.deliverables){if(['completed','cancelled'].includes(d.status)||data.posts.some(p=>p.collaboration_id===c.id&&p.deliverable_id===d.id&&isPublishedPost(p)))continue;rows.push({kind:'collaboration',id:c.id,brand_id:c.brand_id,title:d.title,reason:d.due_date&&d.due_date<date?'Deliverable overdue':'Post pending',date:d.due_date});}}
 for(const p of data.posts){if(!Object.keys(p.latest_metrics||{}).length)rows.push({kind:'post',id:p.id,brand_id:p.brand_id,title:p.caption||label(p.platform)+' post',reason:'Metrics not recorded',date:p.published_at});}
 return rows.sort((a,b)=>String(a.date||'9999').localeCompare(String(b.date||'9999')));
}
export function filterCreators(data,filters){return data.creators.filter(c=>{const accounts=data.accounts.filter(a=>!a.archived&&a.creator_id===c.id);return (!c.archived||filters.archived)&&(!filters.platform||accounts.some(a=>a.platform===filters.platform))&&(!filters.location||(c.locations||[c.location]).includes(filters.location))&&(!filters.category||c.categories.includes(filters.category))&&(!filters.search||[c.name,c.email,c.phone,...(c.locations||[c.location]),...c.categories,...accounts.flatMap(a=>[a.handle,a.display_name])].join(' ').toLowerCase().includes(filters.search.toLowerCase()))}).sort((a,b)=>a.name.localeCompare(b.name));}
