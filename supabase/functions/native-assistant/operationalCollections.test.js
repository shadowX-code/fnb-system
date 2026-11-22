import test from 'node:test';
import assert from 'node:assert/strict';
import {operations,createBusinessDispatcher} from './business.js';
import {rpcPageEvidence} from '../_shared/assistant/readContract.js';

const id='10000000-0000-4000-8000-000000000001';
const other='10000000-0000-4000-8000-000000000002';
const operation=name=>operations.find(op=>op.id===name);
function source(responses,denied=[]){
 const calls=[];
 return {calls,rpc(name,args){
  calls.push({name,args});
  if(name==='current_user_has_permission')return {abortSignal:async()=>({data:!denied.includes(args.permission_code)})};
  if(name==='current_user_can_access_outlet')return {abortSignal:async()=>({data:true})};
  assert.ok(Object.hasOwn(responses,name),'Unexpected domain source '+name);
  const data=responses[name];
  return {abortSignal:async()=>typeof data==='function'?data(args):{data}};
 }};
}

test('complete scoped collections count before paging and keep confidential source fields out of evidence',async()=>{
 const openings=Array.from({length:51},(_,i)=>({id:String(i+100),title:'Cook',status:i<43?'open':'closed',created_at:'2026-11-01',applicant_email:'PRIVATE'})).reverse();
 const caller=source({recruitment_admin_data:{openings}});
 const read=operation('read_recruitment_openings');
 const evidence=await read.execute(caller,{status:'OPEN',page:3});
 assert.equal(evidence.total_matching,43);
 assert.deepEqual(evidence.rows.map(row=>row.id),['140','141','142']);
 assert.equal(evidence.truncated,false);
 assert.equal(JSON.stringify(evidence).includes('PRIVATE'),false);
 const summary=await read.execute(caller,{mode:'summary',status:'open'});
 assert.equal(summary.total_matching,43);
 assert.deepEqual(summary.rows,[]);
 const empty=await read.execute(caller,{title:'unknown'});
 assert.equal(empty.total_matching,0);
 await assert.rejects(read.execute(source({recruitment_admin_data:{}}),{}),{code:'business_read_unavailable'});
});

test('a short source page or missing canonical count cannot become a complete zero',()=>{
 const rows=Array.from({length:3},(_,i)=>({id:i,private:true}));
 assert.deepEqual(rpcPageEvidence(rows,23,2,['id']).rows,[{id:0},{id:1},{id:2}]);
 for(const total of [22,24,null,'23'])assert.throws(()=>rpcPageEvidence(rows,total,2,['id']),{code:'business_read_unavailable'});
 assert.equal(rpcPageEvidence([],0,1,[]).total_matching,0);
});

test('an exact employee name uses both authorities and honors dated assignment history',async()=>{
 const name='Sample Staff';
 const data={
  employee_directory_query:{rows:[{id,full_name:name}],has_more:false},
  employee_employment_assignment_read:{state:'unresolved',as_of:'2020-03-01',verified_from:'2022-01-01',assignment:null,revisions:[{private:true}]},
 };
 function dispatcher(caller,lookup=true){
  return createBusinessDispatcher({caller,access:{permissions:{'employees.view':true}},
   config:{capability_connections:{read_employee_assignment:true,read_employee_directory:lookup}}});
 }
 const inputs={employee_name:name,employee_id:null,on:'2020-03-01'};
 const caller=source(data);
 const result=await dispatcher(caller).execute('read_employee_assignment',inputs);
 assert.equal(result.effective_on,'2020-03-01');
 assert.equal(result.state,'unresolved');
 assert.equal(result.assignment,null);
 assert.equal(result.revisions,undefined);
 assert.deepEqual(caller.calls.at(-1).args,{p_employee_id:id,p_on:'2020-03-01'});
 await assert.rejects(dispatcher(source(data)).execute('read_employee_assignment',{...inputs,employee_id:other}),{code:'entity_ambiguous'});
 const disconnected=source(data);
 await assert.rejects(dispatcher(disconnected,false).execute('read_employee_assignment',inputs),{code:'capability_disconnected'});
 assert.equal(disconnected.calls.length,0);
 await dispatcher(disconnected,false).execute('read_employee_assignment',{employee_id:id});
 assert.equal(disconnected.calls.filter(call=>call.name==='employee_directory_query').length,0);
 const denied=source(data,['employees.view']);
 await assert.rejects(dispatcher(denied).execute('read_employee_assignment',inputs),{code:'business_read_denied'});
 assert.equal(denied.calls.some(call=>call.name==='employee_employment_assignment_read'||call.name==='employee_directory_query'),false);
 const ambiguous=source({...data,employee_directory_query:{rows:[{id,full_name:name},{id:other,full_name:name}],has_more:false}});
 await assert.rejects(dispatcher(ambiguous).execute('read_employee_assignment',inputs),{code:'entity_ambiguous'});
 const partial=source({...data,employee_directory_query:{rows:[{id,full_name:name}],has_more:true}});
 await assert.rejects(dispatcher(partial).execute('read_employee_assignment',inputs),{code:'entity_scope_required'});
 const forbidden=source({...data,employee_employment_assignment_read:()=>({error:{code:'42501'}})});
 await assert.rejects(dispatcher(forbidden).execute('read_employee_assignment',inputs),{code:'business_read_denied'});
});

test('a monthly reward question cannot surface another month or equate no cycle with zero qualified people',async()=>{
 const caller=source({crew_reward_admin_data:{cycles:[
  {id,period_start:'2026-09-01',qualified_count:8},{id:other,period_start:'2026-10-01',qualified_count:0},
 ]}});
 const read=operation('read_crew_reward_cycles');
 const october=await read.execute(caller,{outlet_id:id,month:'2026-10-01'});
 assert.deepEqual(october.rows.map(r=>[r.id,r.qualified_count]),[[other,0]]);
 const november=await read.execute(caller,{outlet_id:id,month:'2026-11-01'});
 assert.deepEqual(november.rows,[]);
 assert.equal(november.total_matching,0);
 assert.equal(november.qualified_count,undefined);
});

test('customer filtered totals remain distinct from whole-brand consent totals, with no private contacts',async()=>{
 const caller=source({marketing_customers_read:{customers:[{id,display_name:'Test',phone_e164:'PRIVATE',contact_state:'subscribed'}],total:1,summary:{total:13,subscribed:5}}});
 const read=operation('read_brand_customer_directory');
 const evidence=await read.execute(caller,{organization_id:id,brand_id:other,page:1,status:'active',consent:'subscribed'});
 assert.deepEqual(caller.calls.at(-1).args.p_filters,{status:'active',consent:'subscribed',sort:'name_asc'});
 assert.equal(evidence.total_matching,1);
 assert.equal(evidence.summary.total,13);
 assert.match(evidence.summary_scope,/Entire authorized brand/);
 assert.equal(JSON.stringify(evidence).includes('PRIVATE'),false);
 assert.throws(()=>read.validate({...evidence.requested_scope,phone:'123'}),{code:'tool_arguments_invalid'});
});

test('calendar end date includes the final fraction of a local day, while trend windows preserve unavailable growth',async()=>{
 const caller=source({marketing_read:{rows:[],total:0},marketing_social_performance:{
  rows:[{ending:'2026-11-30',channel:'social',metric:'views',growth:null,cumulative:3}],windows:[{growth:4,days:7}],timezone:'UTC',
 }});
 const period={organization_id:id,brand_id:other,from:'2026-11-01',to:'2026-11-30'};
 await operation('read_marketing_calendar').execute(caller,{...period,page:1});
 assert.equal(caller.calls.at(-1).args.p_to,'2026-12-01T00:00:00+08:00');
 const trend=await operation('read_marketing_social_performance').execute(caller,{...period,series:'trend',grain:'week',channel:'social'});
 assert.equal(caller.calls.at(-1).args.p_grain,'week');
 assert.equal(trend.rows[0].growth,null);
 assert.equal(trend.rows[0].cumulative,3);
 assert.equal(trend.timezone,'UTC');
});

test('Crew review assignments retain their task names and date while task definition filters stay within their own listing',async()=>{
 const args={outlet_id:id,from:'2026-11-01',to:'2026-11-20',listing:'review_queue',page:1};
 const caller=source({crew_tasks_admin_page_snapshot:{rows:[{task_name:'Closing check',employee_name:'PRIVATE',employee_id:id,business_date:'2026-11-03',status:'review_required'}],total_count:1}});
 const read=operation('read_crew_task_snapshot');
 const evidence=await read.execute(caller,args);
 assert.equal(evidence.total_matching,1);
 assert.deepEqual(evidence.rows,[{name:'Closing check',business_date:'2026-11-03',status:'review_required'}]);
 assert.throws(()=>read.validate({...args,query:'closing'}),{code:'tool_arguments_invalid'});
 await read.execute(caller,{...args,listing:'definitions',query:'100%_clean',status:'active',assignment:'position'});
 assert.deepEqual(caller.calls.at(-1).args.p_filters,{query:'100\\%\\_clean',status:'active',assignment:'position'});
 assert.equal(caller.calls.some(call=>call.name==='crew_tasks_admin_page'),false);
 await assert.rejects(read.execute(source({},['crew_operations.view']),args),{code:'business_read_denied'});
});

test('Crew performance retains the whole-month source summary and Payroll counts periods without exposing runs or employee profiles',async()=>{
 const records=[1,2].map((i)=>({employee:{id:i,full_name:'Member '+i,position:'Crew',contact:'PRIVATE'},result:{status:i===1?'finalized':'pending',total_score:i===1?81:null,manager_note:'PRIVATE'}}));
 const performance=await operation('read_crew_performance_snapshot').execute(source({crew_performance_admin_data_snapshot:{
  period:'2026-11-01',crew:records,summary:{reviewed:1,awaiting_review:1,crew_total:2},reviews:[{manager_note:'PRIVATE'}]}}),
  {outlet_id:id,month:'2026-11-01',status:'pending'});
 assert.equal(performance.total_matching,1);assert.equal(performance.summary.crew_total,2);assert.equal(performance.rows[0].result.total_score,null);
 assert(!JSON.stringify(performance).includes('PRIVATE'));
 const periods=Array.from({length:26},(_,i)=>({id:i,period_start:'2026-11-01',period_end:'2026-11-30',runs:[{revision:1,bank:'PRIVATE'}]}));
 const read=operation('read_payroll_run_status');
 const payroll=await read.execute(source({payroll_foundation_read:{profiles:[{name:'PRIVATE'}],periods}}),{mode:'list',page:2,period_start:'2026-11-01'});
 assert.equal(payroll.total_matching,26);assert.equal(payroll.rows.length,6);
 assert.deepEqual(payroll.rows[0].runs,[{revision:1}]);assert(!JSON.stringify(payroll).includes('PRIVATE'));
 await assert.rejects(read.execute(source({},['payroll.view']),{}),{code:'business_read_denied'});
});

test('audit metadata and role queries preserve their RLS caller, projection, dates, and activity filters',async()=>{
 const calls=[],row={id:'record',module:'Factory',action:'saved',name:'Operator',role_permissions:[{permissions:{code:'factory.view'}}],ip:'PRIVATE',metadata:'PRIVATE'};
 const q=new Proxy({},{get:(_,method)=>method==='abortSignal'?async()=>({data:[row],count:1}):(...args)=>{calls.push([method,...args]);return q;}});
 const caller={...source({}),from(table){calls.push(['from',table]);return q;}};
 const audit=await operation('read_audit_event_metadata').execute(caller,{action:'saved',module:'Factory',from:'2026-11-01',to:'2026-11-01'});
 assert.equal(audit.total_matching,1);assert.equal(audit.rows[0].module,'Factory');
 assert(!JSON.stringify(audit).includes('PRIVATE'));
 assert(calls.some(a=>a[0]==='lt'&&a[2]==='2026-11-01T16:00:00.000Z'));
 assert(calls.some(a=>a[0]==='gte'&&a[2]==='2026-11-01T00:00:00+08:00'));
 const role=await operation('read_role_directory').execute(caller,{name:'Operator',status:'active'});
 assert.deepEqual(role.rows[0].role_permissions,row.role_permissions);assert.equal(role.total_matching,1);
 assert(calls.some(a=>a[0]==='select'&&a[1].includes('role_permissions(permissions(code,module))')));
 assert(calls.some(a=>a[0]==='eq'&&a[1]==='is_active'&&a[2]===true));
});

test('ad snapshots cannot substitute cached dates or expose full report payloads in metadata mode; WhatsApp register retains its owner cap',async()=>{
 const read=operation('read_marketing_ads_evidence'),args={organization_id:id,brand_id:other,from:'2026-11-01',to:'2026-11-04'};
 const reports=Array.from({length:6},(_,i)=>({connection_id:String(i),date_from:args.from,date_to:args.to,observed_at:'2026-11-05',payload:{canonical:'recorded',other:'unrelated'}}));
 const caller=source({marketing_ads_read:{reports,catalogs:[{latest:'PRIVATE'}],jobs:[{lease:'PRIVATE'}]}});
 const list=await read.execute(caller,{...args,mode:'list'});
 assert.equal(list.total_matching,6);assert.equal(list.rows.length,6);assert(!JSON.stringify(list).includes('unrelated'));assert(!JSON.stringify(list).includes('PRIVATE'));
 const legacy=await read.execute(caller,args);assert.equal(legacy.rows.length,5);assert.equal(legacy.rows[0].payload.canonical,'recorded');assert.equal(legacy.truncated,true);
 await assert.rejects(read.execute(source({marketing_ads_read:{reports:[{...reports[0],date_from:'2026-10-01'}]}}),args),{code:'business_read_unavailable'});
 const workflows=operation('read_marketing_workflows'),brand={organization_id:id,brand_id:other};
 for(const count of [1,99,100]){
  const data=source({marketing_whatsapp_workflows:{rows:Array.from({length:count},(_,i)=>({id:i,title:'Published definition '+i,actor:'PRIVATE'})),live_execution:false}});
  const page=await workflows.execute(data,{...brand,page:count>20?5:1});assert.equal(page.total_matching,count===100?null:count);
  assert.equal(page.total_lower_bound,count);assert.equal(page.aggregate_complete,count<100);assert(!JSON.stringify(page).includes('PRIVATE'));
 }
 assert.throws(()=>workflows.validate({...brand,page:6}),{code:'tool_arguments_invalid'});
});

test('Factory audit and storage page through the existing human RPCs with fixed output fields',async()=>{
 for(const [capability,rpc,businessField] of [
  ['read_factory_audit_events','factory_list_audit_trail','event_label'],
  ['read_factory_storage_control','factory_mesti_finished_product_storage_control','packaging_sku_code'],
 ]){
  const caller=source({});
  const upstream=caller.rpc.bind(caller);
  const trace=[];
  caller.rpc=(name,args,options)=>{
   if(name!==rpc)return upstream(name,args);
   assert.deepEqual(args,{p_date_from:'2026-11-01',p_date_to:'2026-11-02'});
   assert.deepEqual(options,{count:'exact'});
   const handle=new Proxy({}, {get:(_,key)=>key==='abortSignal'?
    async()=>({data:[{id,[businessField]:'saved',actor_email:'PRIVATE',before_values:'PRIVATE',completed_by_name:'PRIVATE'}],count:21}):
    (...values)=>{trace.push([key,...values]);return handle;}});
   return handle;
  };
  const result=await operation(capability).execute(caller,{from:'2026-11-01',to:'2026-11-02',page:2});
  assert.equal(result.total_matching,21);
  assert.equal(result.rows[0][businessField],'saved');
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  assert.deepEqual(trace.find(([key])=>key==='range'),['range',20,39]);
  assert(trace.find(([key])=>key==='select')[1].includes(businessField));
  assert(!trace.find(([key])=>key==='select')[1].includes('*'));
 }
});

test('long authorized collection pages preserve their starting record and resume without duplicate reads or data loss',async()=>{
 const {continuedPage}=await import('./businessQuery.js');
 const {verifyReadEvidence}=await import('../_shared/assistant/evidence.js');
 const read=operation('read_factory_raw_control_standards');
 const records=Array.from({length:45},(_,i)=>({raw_material_id:String(i),item:'Food '+i,material_code:'R'+String(i).padStart(3,'0'),
  acceptance_procedure:'Approved receiving procedure. '.repeat(28),control_methods:'Inspect packaging and seal.',secret:'PRIVATE'}));
 const caller=source({factory_mesti_raw_material_control_standards:records});
 const initial=read.validate({mode:'list',page:2});
 const first=await read.execute(caller,initial);
 assert.equal(first.requested_scope.page,2);assert.equal(first.requested_scope.page_size,20);
 assert(first.page_size<20&&first.rows.length>0&&first.rows.length===first.page_size);
 assert.equal(first.rows[0].raw_material_id,'20');assert.equal((first.page-1)*first.page_size,20);
 assert.equal(first.total_matching,45);assert.equal(first.aggregate_complete,true);assert.equal(first.truncated,true);
 assert(!JSON.stringify(first).includes('PRIVATE'));assert(Buffer.byteLength(JSON.stringify(first))<=10000);
 assert.equal(caller.calls.filter(c=>c.name==='factory_mesti_raw_material_control_standards').length,1);
 verifyReadEvidence(read.moduleInterface,read.id,first,initial);
 assert.throws(()=>verifyReadEvidence(read.moduleInterface,read.id,{...first,page:first.page+1},initial),{code:'business_read_unavailable'});
 const ids=first.rows.map(r=>r.raw_material_id);
 let page=first;
 while(page.truncated){
  const next=continuedPage('next page',{turns:[{state:'completed',tool_state:'completed',evidence:page}]},operation);
  assert.equal(next.operation,read.id);assert.equal(next.args.page_size,page.page_size);assert.equal(next.args.page,page.page+1);
  page=await read.execute(caller,next.args);
  verifyReadEvidence(read.moduleInterface,read.id,page,next.args);
  ids.push(...page.rows.map(r=>r.raw_material_id));
 }
 assert.deepEqual(ids,records.slice(20).map(r=>r.raw_material_id));
 assert.throws(()=>read.validate({page:101,page_size:20}),{code:'tool_arguments_invalid'});
 assert.equal(read.validate({page:2000,page_size:1}).page,2000);
 const single={...records[0],acceptance_procedure:'Sensitive individual procedure '.repeat(500)};
 const oversized=source({factory_mesti_raw_material_control_standards:[single]});
 const dispatcher=createBusinessDispatcher({caller:oversized,access:{permissions:{[read.permission]:true}},config:{capability_connections:{[read.id]:true}}});
 const denied=await dispatcher.execute(read.id,{page:1});
 assert.equal(denied.error,'business_result_limit');assert.equal(denied.reason,'single_record_exceeds_evidence_limit');
 assert.equal(denied.query_outcome,'EXECUTION_ERROR');assert.equal(denied.no_evidence,true);assert.equal(denied.rows,undefined);
 assert(!JSON.stringify(denied).includes('Sensitive individual'));
 assert.equal(oversized.calls.filter(c=>c.name==='factory_mesti_raw_material_control_standards').length,1);
});
