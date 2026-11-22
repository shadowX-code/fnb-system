import {AssistantError} from '../assistantError.js';
import {collectionRead} from '../assistant/collectionRead.js';
import {readContract,uuid,date,page,pick,rowsEvidence,boundedPeriod,invalidArgument,rpcPageEvidence} from '../assistant/readContract.js';
const brand={organization_id:uuid,brand_id:uuid};
export const marketingGapReads=[
 readContract({
  id:'read_brand_customer_directory',module_id:'platform_customers',version:2,label:'Brand customer directory and contact eligibility',
  permission:'marketing_audience.view',source:'/marketing/customers',scope:'Current human organization and brand; private contact information and consent evidence are omitted.',
  description:'Count or list customers by recorded active status and contact state. The brand consent summary covers the whole brand. Eligibility never authorizes messaging.',
  properties:{...brand,page,status:{type:'string',enum:['all','active','inactive']},consent:{type:'string',enum:['all','eligible','subscribed','do_not_contact','not_subscribed']}},
  normalizeArguments:a=>({status:'all',consent:'all',...a}),
  interface:{queryKinds:['count','summary','list','filter'],authority:'marketing_customers_read',aggregates:'source_reported',
   pagination:'Exact filtered count with 20 rows per page. Consent summary is for the whole authorized brand.'},
  rpc:'marketing_customers_read',arguments:a=>({p_org:a.organization_id,p_brand:a.brand_id,p_page:a.page,p_size:20,
   p_filters:{status:a.status==='all'?'':a.status,consent:a.consent==='all'?'':a.consent,sort:'name_asc'}}),
  project:(d,a)=>({...rpcPageEvidence(d.customers,d.total,a.page,['id','display_name','active','revision','language','brand_name','outlet_name','contact_state','eligible','suppressed','last_activity']),
   summary:pick(d.summary,['total','subscribed','not_subscribed','do_not_contact']),summary_scope:'Entire authorized brand, before status and consent filters.'}),
 }),
 readContract({
  id:'read_marketing_ads_evidence',module_id:'marketing_ads',version:2,label:'Recorded paid-ad reporting evidence',permission:'marketing_ads.view',source:'/marketing/ads',
  scope:'Existing organization and Brand authority, exact requested reporting dates. Results are recorded snapshots, not spend totals or all-time campaigns.',
  description:'Count exact-period stored reports or list their source metadata. Evidence mode retains the original scoped ad payload. No provider sync, latest-period substitutions, or inference of zero spending from an empty period.',
  properties:{...brand,from:date,to:date,page,mode:{type:'string',enum:['evidence','summary','list']}},
  normalizeArguments:a=>({mode:'evidence',page:1,...a}),check(a){boundedPeriod(a);if(a.mode==='summary'&&a.page!==1)invalidArgument('unsupported_value','page');},
  rpc:'marketing_ads_read',arguments:a=>({p_org:a.organization_id,p_brand:a.brand_id,p_from:a.from,p_to:a.to}),
  project(d,a){
   if(!Array.isArray(d.reports)||d.reports.some(r=>r.date_from!==a.from||r.date_to!==a.to))throw new AssistantError('business_read_unavailable',503);
   const metadata=['connection_id','date_from','date_to','observed_at','observation_generation'];
   const size=a.mode==='evidence'?5:20,offset=(a.page-1)*size;
   const rows=a.mode==='summary'?[]:[...d.reports].sort((l,r)=>String(l.connection_id).localeCompare(String(r.connection_id))||
    String(r.observed_at).localeCompare(String(l.observed_at))||Number(r.observation_generation)-Number(l.observation_generation))
    .slice(offset,offset+size).map(r=>pick(r,a.mode==='evidence'?[...metadata,'payload']:metadata));
   return {rows,total_matching:d.reports.length,aggregate_complete:true,returned_count:rows.length,page:a.page,page_size:size,
    truncated:a.mode!=='summary'&&d.reports.length>offset+size,organization_access:d.organization_access};
  },
  interface:{authority:'marketing_ads_read',queryKinds:['count','summary','list','detail'],aggregates:'complete_filtered_scope',
   fields:['connection_id','date_from','date_to','observed_at','observation_generation','payload'],pagination:'Complete scoped report count. 20 metadata rows or five full evidence reports per page. Large payloads retain the response size guard.',
   semantics:{entities:['ad snapshot'],time:'Exact reporting date pair; observation time is separate.',
    relationships:['Each scoped ad report belongs to its authorized account and exact reporting dates.'],
    metrics:{snapshot_count:{field:'total_matching',unit:'reports',definition:'Selected authorized stored reporting snapshots for the exact dates. Excludes substitute date ranges, sync jobs and catalogs.'}}}},
 }),
 collectionRead({
  id:'read_platform_team_access',module_id:'platform_organizations',label:'Visible team Brand access',
  permission:'platform_organizations.manage',source:'/marketing/settings',scope:'Current human organization membership and visible Brand assignments.',
  description:'Read visible team members and role labels. Restricted brand identities and access grants are excluded.',
  properties:{organization_id:uuid},rpc:'platform_team_brand_access',arguments:a=>({p_org:a.organization_id}),
  records:d=>d.members,fields:['id','name','role_name','access_active','all_brands','brand_ids','restricted_scope','revision'],
  filters:{name:['name'],role:['role_name']},sortBy:[{key:'name'},{key:'id'}],
  metric:{unit:'visible members',definition:'Members included by the organization and Brand scope of the caller.',time:'Current membership.'},
 }),
 collectionRead({
  id:'read_platform_brands',module_id:'brands',label:'Authorized Brands and outlet assignments',
  permission:'platform_organizations.manage',source:'/system/brands',scope:'Current human authorized Brands and their assigned outlet identities.',
  description:'Count or list visible Brands with their current active status and outlet assignments. Excludes branding assets and audit payloads.',
  properties:{},rpc:'platform_brand_management_read',arguments:()=>({}),records:d=>d.brands,
  fields:['id','name','organization_id','is_active','outlet_ids','updated_at'],filters:{name:['name']},sortBy:[{key:'name'},{key:'id'}],
  metric:{unit:'brands',definition:'Distinct Brand records visible to the caller across permitted organizations.',time:'Current Brand management register.'},
 }),
];
