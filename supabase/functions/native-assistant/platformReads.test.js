import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {operations,createBusinessDispatcher} from './business.js';
import {validateBody} from './handler.js';
const id='10000000-0000-4000-8000-000000000001';
const op=name=>operations.find(o=>o.id===name);
const args=o=>Object.fromEntries(Object.entries(o.properties||{}).map(([k,s])=>[k,s.nullable?null:s.type==='array'?[]:s.type==='number'?(s.minimum||1):s.enum?s.enum[0]:k==='page'?1:k.includes('id')?id:k==='query'?'':k==='from'?'2026-11-01':k==='to'?'2026-11-02':'2026-11-01']));
test('fixed connection allowlist covers exactly the shipped contracts',()=>{
 const sql=fs.readFileSync(new URL('../../migrations/20261117061932_native_assistant_gap_read_contracts.sql',import.meta.url),'utf8');
 const ids=[...sql.match(/\$new\$coalesce\(p_payload->>'operation',''\) not in \((.*?)\)\$new\$/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
 assert.deepEqual(['read_employee_directory',...ids],operations.map(o=>o.id));
 const forward=fs.readFileSync(new URL('../../migrations/20261117094742_module_owned_ai_employee_reads.sql',import.meta.url),'utf8');assert(forward.includes("not in ('read_employee_directory','read_recipe_ingredients'"));assert.equal(new Set(ids).size,ids.length);
});
test('every new READ validates exact bounded arguments and rejects arbitrary query selection',()=>{
 for(const o of operations.filter(o=>o.properties)){
  const a=args(o);
  if(o.id==='read_operating_expenses')a.year=2026;
  const valid=o.validate(a);
  assert.throws(()=>o.validate({...a,table:'employees'}));
  if(o.arguments)o.arguments(valid);
  if(o.check)o.check(valid);
 }
});
test('outlet denial prevents fixed RLS table query and projection excludes sensitive fields',async()=>{
 const o=op('read_inventory_orders');let queried=false;
 const caller={rpc(name){return{abortSignal:async()=>({data:name==='current_user_has_permission'})}},from(){queried=true;throw Error('must not query');}};
 await assert.rejects(o.execute(caller,{outlet_id:id,page:1}),{code:'business_read_denied'});assert.equal(queried,false);
 const exposed={id,status:'draft',contact:'private',notes:'private',token:'secret'};
 const page=new Proxy({},{get:(_,key)=>key==='abortSignal'?async()=>({data:[exposed],count:1}):()=>page});
 const allowed={rpc:()=>({abortSignal:async()=>({data:true})}),from:()=>page};
 const p=await o.execute(allowed,{outlet_id:id,page:1});assert.deepEqual(p.rows,[{id,status:'draft'}]);assert.equal(p.total_matching,1);
});
test('published SOP text requires published root and version; excludes media and draft',()=>{
 const o=op('read_crew_published_sop');const args={sop_id:id,query:null};
 assert.equal(o.project({outlet:{id},rows:[{status:'draft',versions:[]}]},args).knowledge.status,'no_current_version');
 const p=o.project({outlet:{id},rows:[{id,title:'SOP',outlet_id:id,status:'published',current_version:1,versions:[{version:2,status:'draft',sections:[{body:'DRAFT'}]},{id,version:1,status:'published',published_at:'2026-01-01',sections:[{title:'Safe',body:'Published text',media_url:'secret'}]}]}]},args);
 assert.equal(p.document_version.version,1);assert(!JSON.stringify(p).includes('DRAFT'));assert(!JSON.stringify(p).includes('secret'));
});
test('FAQ source safety decisions are preserved; unavailable operational claims never returned',()=>{
 const p=op('read_marketing_usable_faq').project({brand:{id},data:{policy:{ai_allowed:true},faqs:[
  {id,is_active:true,status:'approved',use_issue:null,question:'Q',answer:'A',revision:3,knowledge_revision:0},
  {id,is_active:true,status:'approved',use_issue:'Operational information unavailable',answer:'GUESS'},
  {id,is_active:false,status:'approved',use_issue:null,answer:'OLD'},
 ]}},{query:null});assert.equal(p.knowledge.citations.length,1);assert.equal(p.knowledge.citations[0].version,3);assert(!JSON.stringify(p).includes('GUESS'));
});
test('table adapters are fixed, page-bound and use exact human client',async()=>{
 for(const o of operations.filter(o=>o.query?.toString().includes('.from(')&&!o.id.match(/read_(recipe_ingredients|restaurant_|sales_comparison|purchase_comparison|role_directory|audit_event_metadata|factory_raw_catalogue)/))){
  const trace=[];const q=new Proxy({}, {get:(_,method)=>method==='abortSignal'?async()=>({data:[]}):(...a)=>{trace.push([method,...a]);return q;}});
  const caller={rpc:()=>({abortSignal:async()=>({data:true})}),from:(...a)=>{trace.push(['from',...a]);return q;}};
  await o.execute(caller,args(o));assert.equal(trace.filter(x=>x[0]==='from').length,1);assert(trace.some(x=>x[0]==='select'&&!x[1].includes('*')));assert.deepEqual(trace.find(x=>x[0]==='range'),['range',0,20]);
 }
});
test('date windows and evidence size fail closed',async()=>{
 const o=op('read_factory_transfers');assert.throws(()=>o.check({from:'2026-01-01',to:'2026-12-31'}));
 const caller={rpc:n=>({abortSignal:async()=>({data:n==='current_user_has_permission'?true:{total_count:1,rows:[{id,transfer_no:'x'.repeat(12000)}]}})})};
 await assert.rejects(o.execute(caller,{page:1,from:'2026-11-01',to:'2026-11-02'}),{code:'business_result_limit'});
});
test('each ACTION is separately connected/authorized and policy accepts only registered ACTIONs',async()=>{
 for(const o of operations.filter(o=>o.kind==='ACTION')){
  validateBody({action:'action_policy',operation:o.id,enabled:false,expected_revision:1});
  await assert.rejects(createBusinessDispatcher({config:{capability_connections:{[o.id]:true}},access:{permissions:{[o.permission]:true}}}).execute(o.id,{}),{code:'action_not_authorized'});
 }
 assert.throws(()=>validateBody({action:'action_policy',operation:'read_factory_finished_goods',enabled:true,expected_revision:1}));
});

test('permission discovery is one bounded canonical call, missing/error grants fail closed',async()=>{
 const {businessAccess}=await import('./business.js');let calls=0;
 const result=await businessAccess({rpc:async(name,args)=>{calls++;assert.equal(name,'native_assistant_permissions');assert(args.p_codes.length<=128);return{data:{'factory_finished_goods.view':true,'reports.view':false,unexpected:true}};}});
 assert.equal(calls,1);assert.equal(result.factory,true);assert.equal(result.permissions['reports.view'],false);assert(!Object.hasOwn(result.permissions,'unexpected'));
 await assert.rejects(businessAccess({rpc:async()=>({error:{}})}),{code:'admin_required'});
});
test('legacy calibration Admin READ test uses the current schedule with its default scope',async()=>{
 const {dispatch}=await import('./handler.js');const operation=op('read_factory_calibration');
 const config={capability_connections:{[operation.id]:true}};let invoked=0;
 const q={range(){return this;},async abortSignal(){invoked++;return {data:[],count:0};}};
 const result=await dispatch({action:'capability_test',operation:operation.id},{rpc:async()=>({config,can_edit:true}),get:()=>undefined,access:{permissions:{[operation.permission]:true}},caller:{rpc(name){return name==='current_user_has_permission'?{abortSignal:async()=>({data:true})}:q;}}});
 assert.equal(result.outcome,'verified');assert.equal(invoked,1);
});
test('action list forward migration binds owned rows and stored result without variable shadowing',()=>{
 const sql=fs.readFileSync(new URL('../../migrations/20261117040538_native_assistant_action_list_scope.sql',import.meta.url),'utf8');
 assert(sql.includes('t.actor=auth.uid() and t.session_id=sid'));assert(sql.includes('t.created_at,t.result'));assert(sql.includes('action_list_contract_changed'));
});
test('new MeSTI reads keep human RPCs, dates and narrow evidence projections',()=>{
 const waste=op('read_factory_waste_disposal');const p=waste.project([{location_name:'Kitchen',days:{'2026-11-01':{required_count:1,completed_count:0,session_status:null,events:[{completed_by_name:'private'}],verified_by_name:'private'}}}]);
 assert.equal(p.rows[0].days['2026-11-01'].session_status,null);assert(!JSON.stringify(p).includes('private'));
 const raw=op('read_factory_raw_control_evidence');assert.deepEqual(raw.arguments({from:'2026-11-01',to:'2026-11-02'}),{p_date_from:'2026-11-01',p_date_to:'2026-11-02'});assert.equal(raw.permission,'factory_raw_receiving.view');
 assert(!JSON.stringify(raw.project([{id,received_by_name:'private',control_methods_snapshot:'pinned'}],raw.validate({from:'2026-11-01',to:'2026-11-02'}))).includes('private'));
});
test('shared module coverage does not duplicate callable tools or connection authority',()=>{
 const report=op('read_operational_financials');assert(report.related_module_ids.includes('finance_analysis'));
 const config={capability_connections:{[report.id]:true}},access={permissions:{[report.permission]:true}};
 const b=createBusinessDispatcher({config,access});assert.equal(b.tools.filter(t=>t.name===report.id).length,1);
 assert.equal(createBusinessDispatcher({config:{capability_connections:{[report.id]:false}},access}).tools.length,0);
 assert.equal(new Set(operations.flatMap(o=>[o.module_id,...o.related_module_ids||[]])).size,116);
});
