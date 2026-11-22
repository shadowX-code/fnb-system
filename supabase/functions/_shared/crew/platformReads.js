import {AssistantError} from '../assistantError.js';
import {collectionRead} from '../assistant/collectionRead.js';
import {readContract,uuid,date,month,page,pick,rowsEvidence,rpcPageEvidence,boundedPeriod} from '../assistant/readContract.js';
import {crewSopKnowledge} from './sopKnowledge.js';
const outlet={outlet_id:uuid};
const paged={queryKinds:['list','count','filter'],aggregates:'source_reported',pagination:'Exact count of matching rows before paging, 20 per page. Any separately labeled summary retains the source scope.'};
export const crewPlatformReads=[
 readContract({
  id:'read_crew_access_status',module_id:'crew_employees',version:2,label:'Crew access status',permission:'crew_employees.view',source:'/crew',
  scope:'Authorized outlet employee registry; access and employment status are separate.',
  description:'Count or list employees by name/code and employment status. Access-state summary covers the unfiltered outlet. No passcodes, phone numbers or grants.',
  properties:{...outlet,page,query:{type:'string',maxLength:80},employment_status:{type:'string',enum:['all','active','resigned','terminated']}},
  normalizeArguments:a=>({query:'',employment_status:'all',...a}),interface:paged,
  rpc:'crew_access_admin_page',arguments:a=>({p_outlet_id:a.outlet_id,p_filters:{query:a.query,employment_status:a.employment_status==='all'?'':a.employment_status},p_page:a.page,p_page_size:20}),
  project:(d,a)=>({...rpcPageEvidence(d.rows.map(r=>({...r,access_state:r.crew_access?.access_state??'not_enabled'})),d.total_count,a.page,['id','full_name','employee_code','employment_status','is_active','access_state']),
   summary:pick(d.summary,['active','locked','not_enabled']),summary_scope:'All scoped outlet records before the requested filters.'}),
 }),
 readContract({id:'read_crew_feedback_summary',module_id:'crew_customer_feedback',label:'Customer feedback summary',permission:'crew_feedback.view',source:'/crew',scope:'Authorized outlet and month; aggregate only, no customer contacts or feedback bodies',description:'Read canonical feedback counts and trust/scoring categories. No attribution, moderation or follow-up.',properties:{outlet_id:uuid,period:month},rpc:'crew_feedback_admin_page',arguments:a=>({p_outlet_id:a.outlet_id,p_period:a.period,p_filters:{},p_page:1,p_page_size:20}),project:d=>({summary:pick(d.summary,['total_feedback','crew_feedback','food_feedback','outlet_feedback','included_feedback','review_required_feedback','positive_feedback','needs_improvement_feedback','excluded_feedback'])})}),
 collectionRead({id:'read_crew_roster',module_id:'crew_roster',label:'Duty roster assignments',permission:'crew_roster.view',source:'/crew',scope:'Authorized outlet; requested dates',description:'Read saved roster assignments from canonical roster read model. No publication or schedule mutation.',properties:{outlet_id:uuid,from:date,to:date},check:boundedPeriod,rpc:'list_duty_roster_read_model',arguments:a=>({p_outlet_id:a.outlet_id,p_start_date:a.from,p_end_date:a.to}),
  records:d=>d.map(row=>({...row,shift_name:row.shift_template?.name,entry_type:row.entry_type})),
  fields:['id','outlet_id','employee_id','roster_date','shift_template','status','start_time','end_time','entry_type','shift_name'],
  filters:{shift_name:['shift_name'],entry_type:['entry_type']},
  sortBy:[{key:'roster_date'},{key:'employee_id'},{key:'id'}],
  metric:{unit:'roster entries',definition:'Recorded roster entries matching the outlet, date range and filters. Multiple days for one employee count separately.',time:'Requested roster date range.'},
 }),
 readContract({
  id:'read_crew_attendance',module_id:'crew_attendance',version:2,label:'Attendance records',permission:'crew_attendance.view',source:'/crew/attendance',
  scope:'Authorized outlet and requested dates; filters apply to attendance rows and their exact count.',
  description:'Read or count attendance rows by recorded position or Admin exception filter. Unfiltered period summary includes distinct employees present. No GPS, device or exception reasons.',
  properties:{...outlet,from:date,to:date,page,position:{type:'string',maxLength:80,nullable:true},
   status:{type:'string',enum:['all','verified','variance','location_exception','incomplete','no_roster']}},
  normalizeArguments:a=>({position:null,status:'all',...a}),check:boundedPeriod,interface:paged,
  rpc:'crew_attendance_admin_page',arguments:a=>({p_outlet_id:a.outlet_id,p_from:a.from,p_to:a.to,p_page:a.page,p_page_size:20,p_filters:{position:a.position??'all',status:a.status}}),
  project:(d,a)=>({...rpcPageEvidence(d.rows,d.total_count,a.page,['id','employee_id','clock_in_at','clock_out_at','status','roster_date','clock_in_variance_minutes']),
   summary:pick(d.summary,['present','variance','exceptions','incomplete','non_working','no_roster','large_variance']),summary_scope:'Outlet and dates, before position and status filters. Present counts distinct employee identities.'}),
 }),
 ...[['read_crew_cash_checkouts','crew_cash_checkout','checkouts',['id','business_date','status','counted_cash','pos_expected_cash','variance','reconciliation_status']],['read_crew_cash_ledger','crew_cash_deposit','ledger',['id','occurred_at','entry_type','activity','amount_in','amount_out','balance']]].map(([id,module,listing,keys])=>readContract({id,module_id:module,label:listing==='ledger'?'Cash deposit ledger':'Cash checkout records',permission:module+'.view',source:'/crew/cash-checkout',scope:'Authorized outlet, requested dates; no payment or approval',description:'Read existing cash '+listing+' evidence. Omits receiver and contact information. Current balances may include dates outside the requested row window.',properties:{...outlet,from:date,to:date,page},check:boundedPeriod,rpc:'crew_cash_admin_page',arguments:a=>({p_outlet_id:a.outlet_id,p_from:a.from,p_to:a.to,p_listing:listing,p_page:a.page,p_page_size:20}),interface:{...paged,queryKinds:['list','count']},version:2,project:(d,a)=>({...rpcPageEvidence(d.rows,d.total_count,a.page,keys),summary_scope:'Current whole-outlet cash ledger across dates, separate from the filtered rows.',summary:pick(d.summary,['current_balance','available_balance','total_added','total_collected','pending_handover'])})})),
 collectionRead({id:'read_crew_sop_catalogue',module_id:'crew_sop_library',label:'Published SOP catalogue',permission:'crew_sop_library.view',source:'/crew/sop-library',scope:'Authorized outlet; current published SOP metadata only',description:'List published SOP identities and versions for an authorized outlet. Drafts are excluded. Use read_crew_published_sop for actual text.',properties:outlet,rpc:'crew_sop_admin_library',arguments:a=>({p_outlet_id:a.outlet_id}),
  records:d=>d.sops.filter(s=>s.status==='published').map(s=>({...s,versions:s.versions.filter(v=>v.status==='published').map(v=>pick(v,['id','version','effective_date','published_at']))})),
  fields:['id','title','summary','outlet_id','category','versions'],
  filters:{title:['title'],category:['category']},
  sortBy:[{key:'title'},{key:'id'}],
  metric:{unit:'published SOPs',definition:'One published SOP identity per matching catalogue entry, independent of the number of revisions.',time:'Current published catalogue. Document retrieval verifies the effective version separately.'},
 }),
 crewSopKnowledge,
 readContract({
  id:'read_crew_reward_cycles',module_id:'crew_reward',version:2,label:'Reward cycle status',permission:'crew_reward.view',source:'/crew/reward',
  scope:'Authorized outlet and requested calendar month; selected cycle metadata only',
  description:'Read the recorded reward cycle for the requested month with participant and qualified counts. No individual pay, calculation, finalization or payments.',
  properties:{...outlet,month},rpc:'crew_reward_admin_data',arguments:a=>({p_outlet_id:a.outlet_id,p_period:a.month}),
  interface:{queryKinds:['list','count','detail'],authority:'crew_reward_admin_data',aggregates:'complete_filtered_scope',
   pagination:'Only the selected outlet and month. Zero matching cycles does not imply zero qualifying employees.'},
  project(d,a){
   if(!Array.isArray(d.cycles))throw new AssistantError('business_read_unavailable',503);
   const matching=d.cycles.filter(c=>c.period_start===a.month);
   return {...rowsEvidence(matching,['id','period_start','status','participant_count','qualified_count']),total_matching:matching.length,aggregate_complete:true};
  },
 }),
 collectionRead({id:'read_crew_skill_requirements',module_id:'crew_growth',related_module_ids:['crew_growth_skills'],label:'Skill requirements',permission:'crew_growth.view',source:'/crew/growth',scope:'Authorized outlet; skill definitions, not employee scoring',description:'Read skill definitions, requirements version and certification rules; no employee evaluations.',properties:outlet,rpc:'crew_growth_admin_data',arguments:a=>({p_outlet_id:a.outlet_id}),
  records:d=>d.skills,
  fields:['id','name','category','description','status','certification_method','validity_months','requirements_version','updated_at'],
  filters:{name:['name'],category:['category'],status:['status']},
  sortBy:[{key:'name'},{key:'id'}],
  metric:{unit:'skill definitions',definition:'Matching skill definitions registered at the selected outlet. This count does not measure employees or certifications.',time:'Current definition and requirements version.'},
 }),
 readContract({id:'read_crew_team_review_summary',module_id:'crew_team_review',label:'Team review completeness',permission:'crew_performance.review',source:'/crew/team-review',scope:'Authorized outlet and month; aggregate review completeness only',description:'Read team-review window and aggregate counts. Does not return individual comments, submit reviews or calculate scores.',properties:{...outlet,month},rpc:'crew_team_review_admin',arguments:a=>({p_outlet_id:a.outlet_id,p_period:a.month}),project:d=>({period_start:d.period_start,window:pick(d.window,['opens_at','closes_at','status','frozen']),summary:pick(d.summary,['eligible_crew','reviews_received','ready','admin_required'])})}),
];
