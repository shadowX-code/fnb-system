import test from 'node:test';import assert from 'node:assert/strict';
import {operations,createBusinessDispatcher} from './business.js';
import {employeeDirectoryRead as directory} from '../_shared/people/employeeDirectoryRead.js';
import {employeeHeadcount} from '../_shared/people/employeeDirectory.js';
import {rowsEvidence} from '../_shared/assistant/readContract.js';
const args={mode:'summary',employee_id:null,status:'all',legal_entity_id:null,workplace:null,query:'',page:1};
test('employee aggregate needs no IDs, preserves unique identities and separates employment from login',()=>{
 directory.validate(args);assert.equal(directory.arguments(args).p_employee_id,null);
 assert.deepEqual(employeeHeadcount([{id:'a',employment_status:'active',is_active:false},{id:'a',employment_status:'active'},{id:'b',employment_status:'resigned'},{id:'c',employment_status:'terminated'},{id:'d',employment_status:'custom'},{id:'e',employment_status:null}]),{total:5,active:2,inactive:2,resigned:1,terminated:1,other:1});
 assert.throws(()=>directory.validate({...args,table:'employees'}));assert.throws(()=>directory.validate({...args,status:'login_disabled'}));
});
test('employee query uses human permission and fixed RPC with source aggregates, never private fields',async()=>{
 const calls=[];const caller={rpc:(name,a)=>({abortSignal:async()=>{calls.push([name,a]);return {data:name==='current_user_has_permission'?true:{summary:{total:42,active:40,inactive:2,secret:'NO'},rows:[{id:'a',full_name:'Test',bank_account_number:'NO',ic_no:'NO',auth_user_id:'NO'}],total_count:42,page:1,page_size:20,has_more:true,as_of:'source-time',schema_version:1,aggregate_complete:true}};}})};
 const result=await directory.execute(caller,args);
 assert.equal(calls[1][0],'employee_directory_query');assert.equal(result.summary.total,42);assert.equal(result.completeness.aggregate_scope,'complete_filtered_scope');assert.equal(result.source_as_of,'source-time');assert(!JSON.stringify(result).includes('NO'));
 await assert.rejects(directory.execute({rpc:()=>({abortSignal:async()=>({data:false})})},args),{code:'business_read_denied'});
 await assert.rejects(createBusinessDispatcher({config:{},access:{permissions:{'employees.view':true}},caller}).execute(directory.id,args),{code:'capability_disconnected'});
});
test('all operations declare module authority without another dispatcher or ACTION grant',()=>{
 for(const o of operations){assert.equal(o.moduleInterface.module_id,o.module_id);assert.equal(o.moduleInterface.kind,o.kind);assert(o.moduleInterface.human_permission);if(o.kind==='ACTION')assert.match(o.moduleInterface.execution_policy,/confirmed preview/);else {assert(o.moduleInterface.query_kinds.length);assert(o.moduleInterface.exposure);}}
});
test('bounded lists never imply complete inventory, even when no local truncation occurred',async()=>{
 const p=rowsEvidence([{id:'a'}],['id']);assert.equal(p.complete,false);assert.equal(p.truncated,false);assert.match(p.coverage,/not a total/);
 const op=operations.find(o=>o.id==='read_sales_channels');const q=new Proxy({}, {get:(_,k)=>k==='abortSignal'?async()=>({data:[{id:'a'}]}):()=>q});
 const result=await op.execute({rpc:()=>({abortSignal:async()=>({data:true})}),from:()=>q},{page:1});
 assert.equal(result.completeness.aggregate_scope,'not_asserted');assert.match(result.completeness.total_assertion,/Do not derive/);
});
test('core domain summaries retain canonical calculations and flags instead of recounting bounded lists',()=>{
 const finance=operations.find(o=>o.id==='read_operational_financials');const report={status:'partial',revenue:null};assert.equal(finance.project({report}).report,report);
 const factory=operations.find(o=>o.id==='read_factory_operational_pipeline');const fp=factory.project({summary:{scheduled:50},scheduled:[{id:'one'}],released:[],in_progress:[],completed_today:[]});assert.equal(fp.summary.scheduled,50);assert.equal(fp.stages.scheduled.complete,false);
 const marketing=operations.find(o=>o.id==='read_brand_customer_directory');const mp=marketing.project({total:100,summary:{subscribed:70},customers:[{id:'one',contact:'PRIVATE'}]});assert.equal(mp.total_count,100);assert.equal(mp.summary.subscribed,70);assert(!JSON.stringify(mp).includes('PRIVATE'));
 const crew=operations.find(o=>o.id==='read_crew_task_snapshot');assert.equal(crew.rpc,'crew_tasks_admin_page_snapshot');assert.equal(crew.project({total_count:90,rows:[]}).total_count,90);
});
test('already-authorized workforce summary answers headcount without IDs despite bounded distribution rows',()=>{
 const o=operations.find(o=>o.id==='read_workforce_distribution');o.validate({});
 const groups=Array.from({length:70},(_,i)=>({legal_entity_id:String(i),employment_status:i<50?'active':'resigned',n:1}));
 const r=o.project({total:70,groups});assert.equal(r.total,70);assert.equal(r.active,50);assert.equal(r.inactive,20);assert.equal(r.returned_count,60);assert.equal(r.truncated,true);
 assert.throws(()=>o.project({total:71,groups}),{code:'business_read_unavailable'});
});
