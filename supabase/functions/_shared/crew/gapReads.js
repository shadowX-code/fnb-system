import {collectionRead} from '../assistant/collectionRead.js';
import {crewOnboardingKnowledge} from './onboardingKnowledge.js';
import {readContract,uuid,date,month,page,boundedPeriod,invalidArgument,pick,rowsEvidence,rpcPageEvidence} from '../assistant/readContract.js';
export const crewGapReads=[
 readContract({id:'read_crew_task_snapshot',module_id:'crew_operations',version:2,label:'Recorded task definitions and review queue',
  permission:'crew_operations.view',source:'/crew/operations',scope:'Authorized outlet. Definitions are current task series; the review queue counts recorded review-required assignments for the selected dates.',
  description:'Search definition names/types and filter by definition status or assignment type. The dated review queue has a separate row per assignment and returns the task name and business date. Neither path generates instances or recalculates overdue work.',
  properties:{outlet_id:uuid,from:date,to:date,page,listing:{type:'string',enum:['definitions','review_queue']},
   query:{type:'string',nullable:true,maxLength:120},status:{type:'string',nullable:true,maxLength:40},assignment:{type:'string',nullable:true,maxLength:40}},
  normalizeArguments:a=>({query:null,status:null,assignment:null,...a}),
  check(a){boundedPeriod(a);for(const k of ['query','status','assignment']){
   if(a[k]!==null&&!a[k].trim())invalidArgument('nonblank_text_or_null',k);
   if(a.listing==='review_queue'&&a[k]!==null)invalidArgument('unsupported_value',k);
  }},
  outletScope:true,rpc:'crew_tasks_admin_page_snapshot',arguments:a=>({p_outlet_id:a.outlet_id,p_from:a.from,p_to:a.to,p_listing:a.listing,
   p_filters:{status:a.status||'all',assignment:a.assignment||'all',query:(a.query||'').replace(/[\\%_]/g,char=>'\\'+char)},p_page:a.page,p_page_size:20}),
  project:(d,a)=>a.listing==='review_queue'?
   rpcPageEvidence(d.rows.map(r=>({...r,name:r.task_name})),d.total_count,a.page,['name','business_date','status']):
   rpcPageEvidence(d.rows,d.total_count,a.page,['id','name','status','definition_status','task_type','assignment_type','business_date','available_until','completed_at','next_run']),
  interface:{authority:'crew_tasks_admin_page_snapshot',queryKinds:['count','list','search','filter'],aggregates:'source_reported',
   pagination:'Source count and 20-row pages for the chosen listing. Review counts are assignments, not distinct task definitions.',
   semantics:{entities:['Crew task definition','review-required assignment'],time:'Definition state is current. The review queue uses inclusive business dates.',
    relationships:['Review assignments belong to recorded task instances in the selected outlet and period. A definition series may generate many assignments.'],
    metrics:{matching_records:{field:'total_matching',unit:'records in the selected listing',definition:'Current matching task series for definitions, or review-required assignee rows for the outlet and dates.'}}}},
 }),
 collectionRead({
  id:'read_crew_onboarding_progress',module_id:'crew_learning',label:'Recorded onboarding progress',permission:'crew_learning.manage',
  source:'/crew/learning',scope:'Active Crew access at the primary outlet, excluding resigned or terminated employees.',
  description:'Read recorded onboarding progress, including Crew without an assignment. Completed module counts refer to the assigned journey snapshot; this never synchronizes enrollments.',
  properties:{outlet_id:uuid},outletScope:true,rpc:'crew_admin_onboarding_progress_snapshot',arguments:a=>({p_outlet_id:a.outlet_id}),
  records:rows=>rows.map(row=>({...row,employee_key:row.employee.id,employee_name:row.employee.full_name,
   employee:pick(row.employee,['id','full_name','position'])})),
  fields:['assignment_id','journey_id','journey_version','status','started_at','completed_at','progress_percentage','employee','completed_modules','total_modules'],
  filters:{name:['employee_name'],status:['status']},sortBy:[{key:'employee_name'},{key:'employee_key'}],
  metric:{unit:'crew progress records',definition:'One matching progress record per scoped Crew member, including members without a recorded enrollment.',time:'Current saved journey progress.'},
 }),
 collectionRead({
  id:'read_crew_performance_snapshot',module_id:'crew_performance',label:'Recorded performance results',permission:'crew_performance.view',source:'/crew/performance',
  scope:'One authorized outlet and month. Existing saved results only; no score recalculation, manager notes or review submission.',
  description:'Filter recorded results by employee name, position or result status. The monthly summary always covers the whole authorized outlet snapshot, before row filters.',
  properties:{outlet_id:uuid,month},outletScope:true,rpc:'crew_performance_admin_data_snapshot',arguments:a=>({p_outlet_id:a.outlet_id,p_period:a.month}),
  records:d=>d.crew.map(r=>({employee:pick(r.employee,['id','full_name','position']),result:pick(r.result,['id','status','total_score','updated_at','finalized_at','employment_review_required']),
   sort_key:r.employee.id,name:r.employee.full_name,position:r.employee.position,result_status:r.result.status})),
  fields:['employee','result'],filters:{name:['name'],position:['position'],status:['result_status']},sortBy:[{key:'name'},{key:'sort_key'}],
  metric:{unit:'saved performance results',definition:'One matching saved Crew result per member and reporting month; members without recorded results are excluded.',time:'Requested performance month.'},
  decorate:d=>({period:d.period,summary:pick(d.summary,['average_score','reviewed','awaiting_review','crew_total']),
   summary_scope:'Whole recorded outlet/month snapshot before name, position or status filters.'}),
 }),
 readContract({id:'read_crew_daily_brief',module_id:'crew_dashboard',label:'Crew daily operational brief',permission:'crew_dashboard.view',source:'/crew',scope:'Current human authorized outlet; canonical local business date and permission-filtered dashboard',description:'Read the canonical daily brief, attention, upcoming events and tasks. No task materialization or scoring refresh. Lists are bounded; summaries retain source permissions.',properties:{outlet_id:uuid},outletScope:true,rpc:'crew_dashboard_admin_data_v3',arguments:a=>({p_outlet_id:a.outlet_id}),project:d=>({business_date:d.business_date,summary:d.summary,attention:(d.attention||[]).slice(0,10),upcoming:(d.upcoming||[]).slice(0,10),crew_today:rowsEvidence(d.crew_today,['employee_id','name','position','start_time','end_time','status','group']),tasks_today:rowsEvidence(d.tasks_today,['id','name','assignment','due_at','status']),limitations:'Attention and upcoming lists capped at10; Crew rows capped at20.'})}),
 crewOnboardingKnowledge,
];
