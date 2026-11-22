import {collectionRead} from '../assistant/collectionRead.js';
import {directoryRead} from '../assistant/directoryRead.js';
import {workforceStatusCounts} from '../hrWorkforceModel.js';
import {AssistantError} from '../assistantError.js';
import {exactName} from '../assistant/entityResolution.js';
import {boundedPeriod,countedRows,date,invalidArgument,readContract,page,pick,rowsEvidence} from '../assistant/readContract.js';
export const peopleGapReads=[
 readContract({interface:{queryKinds:['summary'],authority:'employee_workforce_summary_read',fields:['total','active','inactive','resigned','terminated','other','status_definition','rows','returned_count','truncated','coverage'],aggregates:'complete_filtered_scope',pagination:'Total covers all authorized employees; distribution groups are capped at60 and may be incomplete.'},id:'read_workforce_distribution',module_id:'hr_dashboard',related_module_ids:['employees'],label:'Authorized workforce distribution',permission:'employees.view',source:'/hr',scope:'Complete current human RLS-visible employee distribution; no employee identities',description:'Read complete unique employee headcount, active and inactive employment counts without an employee ID, plus legal entity/type/status distribution from the canonical workforce source. Counts are scoped to the caller, not an assertion of company-wide access.',properties:{},rpc:'employee_workforce_summary_read',arguments:()=>({}),project:d=>{const summary=workforceStatusCounts(d.groups);if(summary.total!==Number(d.total??0))throw new AssistantError('business_read_unavailable',503);return {...summary,...rowsEvidence(d.groups,['legal_entity_id','employment_type','employment_status','n'],60),status_definition:'Raw HR workforce status; unspecified values remain other. Inactive is resigned or terminated, not login access.'};}}),
 directoryRead({id:'read_role_directory',module_id:'roles',label:'role definitions',permission:'roles.view',source:'/system/roles',
  table:'roles',activeFlag:'is_active',fields:['id','name','description','is_system_role','is_active','outlet_access_type','role_permissions','role_outlets'],
  select:'id,name,description,is_system_role,is_active,outlet_access_type,role_permissions(permissions(code,module)),role_outlets(outlet_id)',
  scope:'Current authorized role directory. Stored permission assignments and outlet scope are declarations. An empty stored permission list does not determine the effective authority of protected Owner or Admin roles.'}),
 readContract({id:'read_audit_event_metadata',module_id:'audit-logs',version:2,label:'Authorized audit event metadata',permission:'audit_logs.view',source:'/system/audit-logs',
  description:'Count or list retained audit events by exact module, action and inclusive Malaysian business dates. Omits before/after data, event descriptions, IP, device and private payloads.',
  scope:'Retained audit metadata under human permission and row access. Counts concern event rows, not distinct actors. The Admin recent-activity view displays up to 250.',
  properties:{page,mode:{type:'string',enum:['list','summary']},module:{type:'string',maxLength:100,nullable:true},action:{type:'string',maxLength:100,nullable:true},
   from:{...date,nullable:true},to:{...date,nullable:true}},
  normalizeArguments:a=>({mode:'list',page:1,module:null,action:null,from:null,to:null,...a}),
  check(a){if(a.mode==='summary'&&a.page!==1)invalidArgument('unsupported_value','page');
   if(!!a.from!==!!a.to)invalidArgument('invalid_date_range','from');
   if(a.from)boundedPeriod(a);
   for(const key of ['module','action'])if(a[key]!==null&&!a[key].trim())invalidArgument('nonblank_text_or_null',key);},
  async load(caller,a,signal){
   const fields=['id','action','module','user_name','created_at'];
   let q=caller.from('audit_logs').select(fields.join(','),{count:'exact',head:a.mode==='summary'});
   for(const key of ['module','action'])if(a[key])q=exactName(q,key,a[key].trim());
   if(a.from){
    const exclusiveEnd=new Date(Date.parse(a.to+'T00:00:00+08:00')+86400000).toISOString();
    q=q.gte('created_at',a.from+'T00:00:00+08:00').lt('created_at',exclusiveEnd);
   }
   const result=await countedRows(q.order('created_at',{ascending:false}).order('id'),a,fields,signal);
   return {...result,returned_count:result.rows.length};
  },
  project:d=>d,interface:{authority:'audit_logs',queryKinds:['count','summary','list','filter'],aggregates:'complete_filtered_scope',
   fields:['id','action','module','user_name','created_at'],pagination:'Exact filtered event count. Twenty events per page with stable timestamp and ID ordering.',
   semantics:{entities:['audit event'],time:'Event creation timestamp; requested calendar dates are inclusive in Malaysia.',
    relationships:['Each retained event belongs to its source module and action; many events can share an actor.'],
    metrics:{event_count:{field:'total_matching',unit:'events',definition:'Retained event rows matching the module/action/date filters under human row access.'}}}},
 }),
 collectionRead({
  id:'read_payroll_run_status',module_id:'hr_dashboard',label:'Authorized payroll periods and run status',permission:'payroll.view',source:'/hr/payroll',
  scope:'Pay periods returned by the canonical Payroll company authority. Metadata only, no compensation, employee identities or payslips.',
  description:'Read period dates and the five most recent run revisions per period. Periods are distinct from runs and employees.',
  properties:{},rpc:'payroll_foundation_read',arguments:()=>({p_profile_id:null,p_period_id:null}),
  records:d=>d.periods.map(p=>({...pick(p,['id','legal_entity_id','period_start','period_end','current_finalized_run_id']),
   runs:p.runs.slice(0,5).map(r=>pick(r,['id','revision','status','created_at','finalized_at'])),runs_truncated:p.runs.length>5})),
  fields:['id','legal_entity_id','period_start','period_end','current_finalized_run_id','runs','runs_truncated'],
  filters:{period_start:['period_start'],period_end:['period_end']},sortBy:[{key:'period_start',descending:true},{key:'id'}],
  metric:{unit:'payroll periods',definition:'Matching payroll periods across legal entities explicitly authorized by Payroll. Each period counts once, independently of revisions.',time:'Recorded payroll period dates.'},
 }),
];
