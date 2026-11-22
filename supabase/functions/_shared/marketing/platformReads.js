import {AssistantError} from '../assistantError.js';
import {collectionRead} from '../assistant/collectionRead.js';
import {marketingBrandKnowledge,marketingFaqKnowledge} from './knowledgeReads.js';
import {readContract,uuid,date,page,pick,rowsEvidence,rpcPageEvidence,boundedPeriod} from '../assistant/readContract.js';
const brand={organization_id:uuid,brand_id:uuid};
const nextLocalMidnight=day=>new Date(Date.parse(day)+86400000).toISOString().slice(0,10)+'T00:00:00+08:00';
const paged={queryKinds:['count','list'],aggregates:'source_reported',pagination:'The canonical filtered count covers all matching records, with up to 20 rows per page.'};
const args=a=>({p_org:a.organization_id,p_brand:a.brand_id});
export const marketingPlatformReads=[
 collectionRead({id:'read_marketing_connection_health',module_id:'marketing_connections',label:'Brand channel connection health',permission:'marketing_settings.view',source:'/marketing/connections',scope:'Authorized brand; connection status/freshness only',description:'Read existing channel connection health. No secrets, tokens, configuration changes, refresh or provider calls.',properties:brand,rpc:'marketing_read',arguments:a=>({...args(a),p_surface:'settings',p_page_size:20}),
  records:d=>d.connections,
  fields:['brand_id','channel','status','expires_at','last_synced_at','error_code'],
  filters:{channel:['channel'],status:['status']},
  sortBy:[{key:'brand_id'},{key:'channel'}],
  metric:{unit:'channel status records',definition:'Matching channel status records including disconnected channels. This count is not a count of healthy connections unless filtered.',time:'Last saved status, expiry and sync timestamps; no fresh provider call.'},
 }),
 collectionRead({id:'read_marketing_creator_posts',module_id:'marketing_creators',label:'Creator publication evidence',permission:'marketing_creators.view',source:'/marketing/creators',scope:'Authorized brand creator posts; recorded evidence, no contacts',description:'Read recorded creator publication dates, revision, metadata provenance and available observed metrics. Does not inspect websites or refresh metrics. Missing metrics are unavailable, not zero.',properties:brand,rpc:'marketing_creator_workspace',arguments:args,
  records:d=>d.posts,
  fields:['id','brand_id','platform','published_at','published_date','publication_confirmed_at','content_type','revision','metadata_source','updated_at','latest_metrics'],
  filters:{platform:['platform'],content_type:['content_type']},
  sortBy:[{key:'created_at',descending:true},{key:'id'}],
  metric:{unit:'creator post records',definition:'Matching creator post records returned by the authorized brand workspace. A record is not proof of reach or a verified sale.',time:'Current saved workspace with recorded publication dates.'},
 }),
 marketingFaqKnowledge,
 marketingBrandKnowledge,
 ...[['read_marketing_inbox_metrics','marketing_inbox','social_inbox'],['read_marketing_whatsapp_metrics','marketing_whatsapp_chat','whatsapp']].map(([id,module,channel])=>readContract({id,module_id:module,label:channel==='whatsapp'?'WhatsApp inbox metrics':'Social inbox metrics',permission:'marketing_inbox.view',source:'/marketing/inbox',scope:'Authorized brand; conversations created in requested period; no message bodies',description:'Read observed inbox volume and response metrics. Unavailable automation rate is not zero. No messages sent or marked read.',properties:{...brand,from:date,to:date},check:boundedPeriod,rpc:'marketing_inbox_analytics',arguments:a=>({...args(a),p_channel:channel,p_start:a.from+'T00:00:00+08:00',p_end:nextLocalMidnight(a.to)}),project:d=>({summary:pick(d,['volume','unresolved','human_handovers','first_response_seconds','first_response_sample','ai_reply_proposals','ai_acceptance_rate','automation_rate','automation_unavailable_reason','cohort'])})})),
 readContract({id:'read_marketing_overview',module_id:'marketing_overview',label:'Content lifecycle totals',permission:'marketing_overview.view',source:'/marketing',scope:'Authorized organization and brand; all-time content status totals',description:'Read content lifecycle counts, not delivery metrics or real-time execution.',properties:brand,rpc:'marketing_read',arguments:a=>({...args(a),p_surface:'overview',p_page_size:20}),project:d=>({summary:pick(d.summary,['draft','review','approved','scheduled','published','failed','cancelled','rejected'])})}),
 readContract({id:'read_marketing_calendar',module_id:'marketing_calendar',label:'Scheduled content',permission:'marketing_calendar.view',source:'/marketing/calendar',scope:'Authorized brand; date window and page',description:'Read scheduled content status for up to 31 days, including title and revision. No publishing or asset URLs.',properties:{...brand,from:date,to:date,page},check:boundedPeriod,rpc:'marketing_read',arguments:a=>({...args(a),p_surface:'calendar',p_from:a.from+'T00:00:00+08:00',p_to:nextLocalMidnight(a.to),p_page:a.page,p_page_size:20}),interface:paged,version:2,project:(d,a)=>rpcPageEvidence(d.rows.map(r=>({...r,title:r.payload?.title})),d.total,a.page,['id','title','brand_name','status','revision','scheduled_at','updated_at'])}),
 readContract({id:'read_marketing_media',module_id:'marketing_media',label:'Ready media metadata',permission:'marketing_content.view',source:'/marketing/media',scope:'Authorized brand; ready assets only',description:'Read ready media metadata. Does not return storage paths, access URLs or asset bodies.',properties:{...brand,page},rpc:'marketing_listing',arguments:a=>({...args(a),p_kind:'assets',p_page:a.page,p_page_size:20}),interface:paged,version:2,project:(d,a)=>rpcPageEvidence(d.rows,d.total_count,a.page,['id','filename','mime_type','size_bytes','state','created_at'])}),
 collectionRead({
  id:'read_marketing_social_performance',module_id:'marketing_analytics',label:'Observed social performance',
  permission:'marketing_analytics.view',source:'/marketing/analytics',
  scope:'Authorized brand, stored provider observations in UTC, requested period and grain.',
  description:'Read measured channel and metric trends by day, week or month, or the fixed 7/30-day windows ending on the requested end date. Growth requires comparable observations; missing growth is unavailable.',
  properties:{...brand,from:date,to:date,series:{type:'string',enum:['windows','trend']},grain:{type:'string',enum:['day','week','month']}},
  normalizeArguments:a=>({series:'windows',grain:'month',...a}),check:boundedPeriod,
  rpc:'marketing_social_performance',arguments:a=>({...args(a),p_from:a.from,p_to:a.to,p_grain:a.grain}),
  records:(data,a)=>a.series==='trend'?data.rows:data.windows,
  fields:['kind','starting','ending','days','channel','metric','observed_posts','available_posts','paired_posts','cumulative','growth','cohort','first_observed_at','last_observed_at'],
  filters:{channel:['channel'],metric:['metric']},sortBy:[{key:'ending'},{key:'starting'},{key:'channel'},{key:'metric'}],
  metric:{unit:'metric observations',time:'Provider observation dates in UTC.',definition:'Number of returned channel, metric and period combinations, independent of the number of posts.'},
  decorate:d=>pick(d,['timezone','first_observation_date','observation_days']),
 }),
 ...[
  {id:'read_marketing_campaigns',module:'marketing_campaigns',key:'campaigns',label:'Campaign status',filters:{title:['title'],status:['status']},
   fields:['id','name','title','status','revision','created_at','updated_at','scheduled_at'],sortBy:[{key:'created_at',descending:true},{key:'id'}]},
  {id:'read_marketing_audiences',module:'marketing_audience',key:'audiences',label:'Audience eligibility totals',filters:{name:['name']},
   fields:['id','name','eligible_count','revision','created_at','updated_at'],sortBy:[{key:'name'},{key:'id'}]},
 ].map(({id,module,key,label,filters,fields,sortBy})=>collectionRead({
  id,module_id:module,label,permission:module+'.view',source:'/marketing/'+key,
  scope:'Authorized brand; metadata only, no recipient contacts',
  description:'Read existing '+key+' metadata. Recipient eligibility is owned by the source, and audiences may overlap.',
  properties:brand,rpc:'marketing_outreach_read',arguments:args,records:d=>d[key],fields,filters,sortBy,
  metric:{unit:key,time:'Current recorded brand workspace.',definition:'Number of matching '+key+' in this brand. This does not count distinct recipients.'},
 })),
 readContract({
  id:'read_marketing_workflows',module_id:'marketing_whatsapp_workflows',version:2,label:'Workflow definitions status',permission:'marketing_campaigns.view',source:'/marketing/whatsapp-workflows',
  scope:'Authorized Brand and organization. Up to the 100 most recently updated workflow definitions, not messages or executions.',
  description:'Page current workflow titles, revisions and state. The source caps its latest definitions at 100; at that limit only a lower bound is known. This never runs a flow.',
  properties:{...brand,page:{...page,maximum:5}},normalizeArguments:a=>({page:1,...a}),rpc:'marketing_whatsapp_workflows',arguments:args,
  project(d,a){
   if(!Array.isArray(d.rows)||d.rows.length>100)throw new AssistantError('business_read_unavailable',503);
   const fields=['id','title','revision','state','updated_at','batch_size','follow_up_hours'],offset=(a.page-1)*20;
   const rows=d.rows.slice(offset,offset+20).map(r=>pick(r,fields)),known=d.rows.length<100;
   return {rows,page:a.page,page_size:20,returned_count:rows.length,truncated:d.rows.length>offset+20,
    source_limit_reached:!known,total_matching:known?d.rows.length:null,total_lower_bound:d.rows.length,aggregate_complete:known,live_execution:d.live_execution,
    limitations:known?'Source reported fewer than the 100-definition ceiling.':'Only the latest 100 workflow definitions are visible. The full count is unknown.'};
  },
  interface:{authority:'marketing_whatsapp_workflows',queryKinds:['count','list'],aggregates:'source_reported',pagination:'Up to five pages from the latest 100 definitions. At 100 the source does not distinguish exactly 100 from more.',
   semantics:{entities:['workflow definition'],time:'Current revision ordered by update time.',relationships:['The current revision belongs to the workflow in this Brand; definitions do not imply live execution.'],metrics:{known_count:{field:'total_matching',unit:'definitions',definition:'Complete current Brand workflow count only below the source limit. At 100 use total_lower_bound.'}}}},
 }),
];
