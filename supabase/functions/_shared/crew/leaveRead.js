import {AssistantError} from '../assistantError.js';
import {readContract,uuid,date,page,pick} from '../assistant/readContract.js';

export const leaveRead=readContract({
 id:'read_crew_leave',module_id:'crew_leave',version:2,label:'Outlet leave requests',permission:'crew_leave.view',
 scope:'Current Admin authorized outlet; no Crew impersonation',source:'/crew/workforce/leave',
 discoveryPhrases:['leave requests','crew leave','cuti kru','请假申请','請假申請'],
 description:'Count or page leave requests overlapping an explicit date range for one outlet. Filter by approval status. Reasons, leave type, medical documents and roster details are excluded.',
 properties:{outlet_id:uuid,from:date,to:date,page,status:{type:'string',enum:['all','pending','approved','rejected','cancelled']}},
 normalizeArguments:args=>args&&typeof args==='object'&&!Array.isArray(args)?{page:1,status:'all',...args}:args,
 check(args){if(args.from>args.to)throw new AssistantError('tool_arguments_invalid',400);},
 rpc:'crew_leave_requests_admin_page',
 arguments:a=>({p_outlet_id:a.outlet_id,p_from:a.from,p_to:a.to,p_filters:a.status==='all'?{}:{status:a.status},p_page:a.page,p_page_size:20}),
 project(data,args){
  const {total_count:total,rows}=data,first=(args.page-1)*20;
  if(!Number.isSafeInteger(total)||total<0||!Array.isArray(rows)||rows.length>20)
   throw new AssistantError('business_read_unavailable',503);
  return {total_matching:total,returned:rows.length,aggregate_complete:true,page:args.page,truncated:total>first+rows.length,
   rows:rows.map(r=>({...pick(r,['id','status','start_date','end_date','requested_days']),employee:pick(r.employee,['id','name'])}))};
 },
 interface:{semantics:{
  entities:['leave request','outlet','employee'],time:'Requests overlapping the inclusive date range.',
  relationships:['One employee can submit multiple requests for the outlet.'],
  metrics:{leave_request_count:{field:'total_matching',unit:'requests',definition:'Requests overlapping the period that match the approval-status filter.'}}},
  queryKinds:['count','list','filter'],aggregates:'source_reported',
  pagination:'The canonical total is filtered by overlap and approval status; pages contain up to 20 rows.',
  unsupported:['Leave balances, reasons, leave type and medical documents are outside this read.']},
});
