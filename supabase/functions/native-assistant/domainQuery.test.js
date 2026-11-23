import {finishedGoodsFixture} from '../../../qa/fixtures/assistantFinishedGoods.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {operations,createBusinessDispatcher,businessCapabilities,modulePolicyMembers,validateBusinessArguments} from './business.js';
import {readInventory,inventoryArguments} from '../_shared/factory/finishedGoodsRead.js';
import {employeeDirectoryRead} from '../_shared/people/employeeDirectoryRead.js';
import {domainQueryInstructions} from '../_shared/assistant/moduleInterface.js';
import {voiceInstructions} from './realtime.js';
import {generateText} from './provider.js';
import {dispatch,validateBody} from './handler.js';
import {semanticCatalog} from '../../../scripts/assistantBusinessMatrix.mjs';
import {resolveCanonicalPath} from '../../../src/app/routeOwnership.js';
import {adminModuleBinding,domainSqlNames,presentationBindings,referencedPublicFunctions,routeAssemblySignature} from '../../../scripts/assistantModuleSources.mjs';
const factory='read_factory_finished_goods';
test('owner RPCs selected by scoped register or helper remain covered by migration drift checks',()=>{
 const names=domainSqlNames("const sources={history:'history_read'}; export const load=(name)=>query(name||'owner_options');");
 const sql='create or replace function public.history_read() returns jsonb; CREATE FUNCTION "public"."owner_options"() returns jsonb; create function private.history_read(); create function public.unrelated(); revoke execute on function public.owner_options() from authenticated; select public.history_read();';
 assert.deepEqual(referencedPublicFunctions(sql,names),['history_read','owner_options','owner_options']);
});
test('Admin parity follows a route selector through shared workspaces to its demonstrated page or legacy renderer',()=>{
 const factory=adminModuleBinding({id:'factory_equipment'});
 assert.deepEqual(factory.owners,['src/features/factory/pages/FactoryEquipmentPage.jsx']);
 assert.equal(factory.props.initialTab,'equipment');assert.match(factory.permission,/factory_equipment\.view/);
 assert(factory.via.includes('src/features/factory/pages/FactoryWorkspaceRuntime.jsx'));
 const legacy=adminModuleBinding({id:'factory_raw_receiving'});
 assert.deepEqual(legacy.callbacks,['legacy.renderRawReceiving']);assert.deepEqual(legacy.owners,[]);
 const inventory=adminModuleBinding({id:'inventory_master'}),dashboard=adminModuleBinding({id:'inventory_dashboard'});
 assert.deepEqual(inventory.owners,['src/features/sales-purchase/inventory/master/InventoryMasterPage.jsx']);
 assert.deepEqual(dashboard.owners,['src/features/sales-purchase/inventory/dashboard/InventoryDashboardPage.jsx']);
});
test('Admin drift follows read calls, filters, permissions and sources without hashing UI copy, spacing or colors',()=>{
 const file='src/features/fixture/Local.jsx';
 const page='import {stock} from "./stockService.js"; export default function Page({auth,outlet}) { if(!auth.can("stock.view")) return null; const data=stock.list({outlet, status:"active"}); return <div className="p-4 text-teal">Stock {data.total}</div>; }';
 const sig=source=>presentationBindings(source,file);
 const base=sig(page);
 assert.deepEqual(base,sig(page.replace('p-4 text-teal','p-6 text-green').replace('>Stock ','>Current inventory ').replace('stock.list({','stock.list( /* selected outlet */ {')));
 for(const [from,to] of [['stock.list','stock.summary'],['stockService.js','otherSource.js'],['stock.view','stock.edit'],['status:"active"','status:"all"']])
  assert.notDeepEqual(base,sig(page.replace(from,to)));
 assert.deepEqual(base,sig('import useTheme from "./hooks/useTheme.js";'+page));
 assert.notDeepEqual(sig('export const P = ({store}) => <div>{store.sales.length}</div>;'),
  sig('export const P = ({store}) => <div>{store.purchases.length}</div>;'));
 const routes='export const salesPurchaseRoutes = modules.filter(m => m.routable).map(m => ({component:m.view,permission:m.readPermission,label:"Stock"}));';
 assert.deepEqual(routeAssemblySignature(routes),routeAssemblySignature(routes.replace('"Stock"','"Assets"')));
 assert.notDeepEqual(routeAssemblySignature(routes),routeAssemblySignature(routes.replace('m.readPermission','null')));
});
test('business catalog follows canonical module ownership and clearly identifies source-only limitations',()=>{
 const catalog=semanticCatalog();
 const modules=new Map(catalog.modules.map(row=>[row.module,row]));
 assert.equal(modules.size,catalog.modules.length);
 assert(catalog.modules.every(row=>row.coverage&&row.boundary));
 for(const operation of operations){
  const entry=catalog.operations.find(row=>row.operation===operation.id);
  assert.equal(entry.owner,operation.module_id);
  assert.deepEqual(entry.query,operation.moduleInterface.query||null);
  const owner=modules.get(entry.owner);
  assert((operation.kind==='READ'?owner.reads:owner.actions).includes(operation.id));
  for(const shared of entry.shared_with)assert(modules.get(shared).shared_reads.includes(operation.id));
 }
 const assets=catalog.operations.find(row=>row.operation==='read_asset_catalogue');
 assert.equal(assets.semantics.metrics.quantity_change.unit_field,'asset.unit');
 assert.equal(catalog.operations.find(row=>row.operation==='read_factory_equipment_cleaning_requirements').semantics.metrics.entry_count.field,'total_matching');
 assert.equal(catalog.operations.find(row=>row.operation==='read_accounting_source_health').semantics.metrics.record_count.unit,'accounting connections');
 assert.equal(catalog.operations.find(row=>row.operation==='read_assistant_system_guidance').source_type,'system_guidance');
 for(const id of ['read_purchase_records','read_supplier_directory','read_purchase_categories','read_outlet_directory',
  'read_sales_channels','read_factory_equipment','read_factory_raw_catalogue','read_crew_leave']){
  const entry=catalog.operations.find(row=>row.operation===id);
  assert.equal(resolveCanonicalPath(entry.source)?.routeId,entry.owner);
  assert.equal(modules.get(entry.owner).route,entry.source);
 }
});
test('discovery selects a unique owner-declared measure and preserves ambiguity, scope and policy',async()=>{
 const access={permissions:Object.fromEntries(operations.map(op=>[op.permission,true]))};
 const config={capability_connections:Object.fromEntries(operations.map(op=>[op.id,true]))};
 const business=createBusinessDispatcher({config,access});
 const find=search=>business.execute('find_business_queries',{search,page:1});
 const finance=await find('How did purchase-based COGS change?');
 assert.equal(finance.preferred_operation,'read_operational_financials');
 assert.equal(finance.operations[0].semantics.metrics.purchase_based_cogs.unit,'MYR');
 assert.equal(finance.not_business_evidence,true);
 assert.equal((await find('How many employees do we have?')).preferred_operation,'read_employee_directory');
 const mixed=await find('What about leave requests and creative tasks?');
 assert.equal(mixed.preferred_operation,null);
 assert.deepEqual(new Set(mixed.operations.map(row=>row.operation)),new Set(['read_marketing_plan','read_crew_leave']));
 assert.equal((await find('Show me whatever is low')).operations.length,0);
 config.capability_connections.read_operational_financials=false;
 for(const search of ['How did purchase-based COGS change?','read_operational_financials']){
  const disabled=await find(search);
  assert.equal(disabled.preferred_operation,null);
  assert(!disabled.operations.some(row=>row.operation==='read_operational_financials'));
 }
});
test('Voice supplier discovery follows the saved utterance and exposes only authorized scopes',async()=>{
 const id='96b39786-ae76-499c-a93a-9ba2374acbd3';
 const annual='read_purchase_comparison',monthly='read_purchase_records';
 const access={permissions:{'purchase_input.view':true,'purchase_comparison.view':true,'operating_expenses.view':true}};
 const config={enabled:true,capability_connections:{[monthly]:true,[annual]:false,read_operating_expenses:true}};
 const traces=[];
 let prompt='我想知道 French Corner 每个月的 supplier 采购';
 const deps={access,get:()=>undefined,reserveRealtime:async()=>{},voiceHistory:()=>assert.fail('Discovery is never saved as a READ'),
  rpc:async action=>action==='history'?{turns:[{request_id:id,voice_input_available:true,prompt}]}:{config},
  traceVoice:(event,fields)=>traces.push({event,...fields})};
 const call=(tool,args)=>dispatch({action:'realtime_tool',provider:'openai',request_id:id,turn_id:id,session_id:id,operation:tool,arguments:args},deps);
 const find=()=>call('find_business_queries',{search:'supplier',page:1});
 const result=await find();
 assert.equal(result.query_outcome,'UNAUTHORIZED');
 assert.deepEqual(result.next_step,{kind:'offer_narrower_scope'});
 assert.deepEqual(result.operations,[]);
 assert.deepEqual(result.narrower_reads.map(row=>row.operation),[monthly]);
 assert.match(result.answer_hint,/月/);
 assert.equal(result.not_business_evidence,true);
 // The possible monthly question has not been asked. Do not execute it or use
 // Operating Expenses as a substitute for the unavailable period.
 const envelope=op=>({operation:op,arguments_json:'{}'});
 for(const op of [monthly,'read_operating_expenses'])
  await assert.rejects(call('run_business_query',envelope(op)),{code:'tool_not_allowed'});
 const text=await generateText({kind:'turn',prompt},'unused',{business:createBusinessDispatcher({config,access}),transport:()=>assert.fail('No provider request')});
 assert.equal(text.output_tokens,0);assert(text.reply.includes(result.answer_hint));
 access.permissions['purchase_input.view']=false;
 assert.deepEqual((await find()).narrower_reads,[]);
 access.permissions['purchase_input.view']=true;
 config.capability_connections[monthly]=false;
 assert.equal((await find()).next_step.kind,'report_unavailable');
 config.capability_connections[monthly]=true;
 config.capability_connections[annual]=true;
 const examples=[
  [prompt,annual],
  ['Berapakah jumlah pembelian pembekal setiap bulan di French Corner?',annual],
  ['How much did French Corner spend on supplier purchases last month?',monthly],
 ];
 for(const [utterance,op] of examples){
  prompt=utterance;
  const available=await find();
  assert.deepEqual(available.next_step,{kind:'read',tool:'run_business_query',operation:op});
  assert.deepEqual(available.operations.map(row=>row.operation),[op]);
  assert(available.operations[0].parameters.properties.month);
  assert.deepEqual(traces.at(-1).matched_operations,[op]);
  assert(!JSON.stringify(traces).includes('French Corner'));
 }
 prompt=examples[0][0];
 deps.caller={rpc:()=>({abortSignal:async()=>({data:true})}),from:table=>{
  assert.equal(table,'outlets','No purchase rows before the outlet is confirmed');
  const query={select:()=>query,order:()=>query,limit:()=>query,abortSignal:async()=>({data:[{id,name:'Friends Corner',code:'FC'}]})};
  return query;
 }};
 await assert.rejects(call('run_business_query',{operation:annual,arguments_json:JSON.stringify({outlet_name:'Friends Corner',mode:'supplier_year',month:'2026-01-01'})}),{code:'entity_scope_required'});
});
function inventoryCaller(rows){return {rpc:name=>{const value={data:name==='current_user_role_id'?'role':name==='current_user_has_permission'?true:rows.map(r=>r.id)};return {then:f=>Promise.resolve(value).then(f),abortSignal:async()=>value};},from:()=>({select:()=>({in:(_key,ids)=>({abortSignal:async()=>({data:rows.filter(r=>ids.includes(r.id))})})})})};}
test('Factory count, pagination, exact SKU detail and legacy arguments share one authority',async()=>{
 const rows=Array.from({length:45},(_,i)=>({id:String(i).padStart(2,'0'),product_code:'SKU'+i,product_name:'Product '+String(i).padStart(2,'0'),current_balance:i,min_stock_level:10}));
 const caller=inventoryCaller(rows),base={query:'',availability:'all'};
 const legacy=await readInventory(caller,base),p2=await readInventory(caller,{...base,mode:'list',page:2,sku:null}),summary=await readInventory(caller,{...base,mode:'summary',page:1,sku:null});
 assert.equal(summary.total_matching,45);assert.equal(summary.low_stock_count,10);assert.equal(summary.out_of_stock_count,1);assert.equal(summary.rows.length,0);assert.equal(p2.rows.length,20);assert.equal(p2.total_matching,45);assert(!p2.rows.some(r=>legacy.rows.some(l=>l.id===r.id)));
 const detail=await readInventory(caller,{...base,mode:'detail',page:1,sku:'SKU24'});assert.equal(detail.rows[0].id,'24');assert.equal(detail.detail_found,true);
 const low=await readInventory(caller,{...base,availability:'low'});assert.equal(low.total_matching,10);
 assert.throws(()=>inventoryArguments({...base,mode:'detail',sku:null}));assert.throws(()=>inventoryArguments({...base,outlet_id:'arbitrary'}));
});
test('employee modes preserve old callers and reject unsupported filters; migration does not rewrite access',()=>{
 const a={mode:'summary',employee_id:null,status:'all',legal_entity_id:null,workplace:null,query:'',page:1};
 assert.equal(employeeDirectoryRead.validate(a).outlet_id,null);
 assert.equal(employeeDirectoryRead.validate({mode:'summary'}).employee_id,null);
 assert.equal(employeeDirectoryRead.validate({mode:'summary'}).status,'all');
 assert.equal(employeeDirectoryRead.validate({...a,employment_type:'permanent'}).employment_type,'permanent');
 assert.throws(()=>employeeDirectoryRead.validate({...a,include_bank:true}));
 const sql=fs.readFileSync('supabase/migrations/20261117103349_assistant_domain_query_semantics.sql','utf8');
 assert.match(sql,/security invoker/i);assert.match(sql,/current_user_can_access_outlet\(p_outlet_id\)/);assert.match(sql,/crew_resolve_employee_outlet\(e.id\)=p_outlet_id/);
 assert.match(sql,/group by employment_type/);assert.match(sql,/create or replace function public.employee_directory_read/);
 const beforeBranch=sql.split('-- Atomic module policy')[0];assert(!/update feedx_integrations/.test(beforeBranch));
 assert.deepEqual(modulePolicyMembers('employees'),['read_employee_directory','read_employee_assignment']);
 assert.throws(()=>modulePolicyMembers('payroll'));assert.throws(()=>validateBody({action:'capability_connection',operation:'module:payroll',enabled:true,expected_revision:23}));
});
test('mixed legacy policies stay mixed; no module or ACTION blanket inheritance',async()=>{
 const config={capability_connections:{read_employee_assignment:true},module_reads:{employees:true}};
 const access={permissions:{'employees.view':true}};
 const caps=businessCapabilities(config,access);
 assert.equal(caps.find(c=>c.id==='read_employee_directory').connection_enabled,false);
 assert.equal(caps.find(c=>c.id==='read_employee_assignment').connection_enabled,true);
 await assert.rejects(createBusinessDispatcher({config,access}).execute('read_employee_directory',{}),{code:'capability_disconnected'});
 assert(caps.filter(c=>c.kind==='ACTION').every(c=>c.availability==='disabled'));
});
test('large tool inventories use bounded discovery and the same dispatcher authorization',async()=>{
 let reads=0;let config={capability_connections:Object.fromEntries(operations.map(o=>[o.id,true]))};
 const access={factory:true,permissions:Object.fromEntries(operations.map(o=>[o.permission,true]))};
 const b=createBusinessDispatcher({config,access,readFactory:async args=>{reads++;return finishedGoodsFixture(Array.from({length:45},()=>({})))(args);},loadConfig:async()=>config});
 assert.deepEqual(b.tools.map(t=>t.name),['find_business_queries','run_business_query']);assert(JSON.stringify(b.tools).length<2000);
 const found=await b.execute('find_business_queries',{search:'factory finished goods',page:1});assert(found.discovery_only);assert(found.operations.some(o=>o.operation===factory));assert(found.operations.length<=8);assert.equal(reads,0);
 const a={operation:factory,arguments_json:JSON.stringify({query:'',availability:'all',mode:'summary',page:1,sku:null})};
 validateBusinessArguments('run_business_query',a);assert.equal((await b.execute('run_business_query',a)).total_matching,45);
 config={capability_connections:{}};await assert.rejects(b.execute('run_business_query',a),{code:'capability_disconnected'});assert.equal(reads,1);
 assert.equal((await b.execute('find_business_queries',{search:'',page:1})).operations.length,0);
 await assert.rejects(b.execute('run_business_query',{operation:'arbitrary_sql',arguments_json:'{}'}),{code:'tool_not_allowed'});
});
test('Text can discover then query with bounded schema payload; Voice gets the identical follow-up semantics',async()=>{
 assert(voiceInstructions.includes(domainQueryInstructions));
 const config={capability_connections:Object.fromEntries(operations.map(o=>[o.id,true]))},access={factory:true,permissions:Object.fromEntries(operations.map(o=>[o.permission,true]))};
 const b=createBusinessDispatcher({config,access,readFactory:finishedGoodsFixture(Array.from({length:45},()=>({})))});let n=0;const evidence=[];
 const reply=await generateText({kind:'turn',model:'gpt-4o-mini',prompt:'How many finished products?',context:[]},'fixture',{
 business:b,onTool:(state,e)=>{if(e)evidence.push(e);},transport:async(_url,init)=>{
  const body=JSON.parse(init.body);assert(Buffer.byteLength(init.body)<24000);assert(body.instructions.includes(domainQueryInstructions));
  const output=++n===1?[{type:'function_call',name:'find_business_queries',call_id:'one',arguments:'{"search":"factory finished goods","page":1}'}]:n===2?[{type:'function_call',name:'run_business_query',call_id:'two',arguments:JSON.stringify({operation:factory,arguments_json:'{"query":"","availability":"all","mode":"summary","page":1,"sku":null}'})}]:[{type:'message',content:[{type:'output_text',text:'45 products in the authorized catalogue.'}]}];
  return new Response(JSON.stringify({status:'completed',output,usage:{input_tokens:100,output_tokens:10}}));
 }});
 assert.equal(n,3);assert.match(reply.reply,/45 products/);assert.equal(evidence.length,1);assert.equal(evidence[0].capability,factory);
});
test('malformed envelope gets safe schema feedback after authorization, before any query',async()=>{
 let called=0;const config={capability_connections:{read_employee_directory:true}},access={permissions:{'employees.view':true}};
 const b=createBusinessDispatcher({config,access,caller:{rpc:()=>{called++;throw Error('must not query');}}});
 const result=await b.execute('run_business_query',{operation:'read_employee_directory',arguments_json:'{"mode":"unknown"}'});
 assert.equal(result.error,'tool_arguments_invalid');assert(result.not_business_evidence);assert.equal(result.parameters.additionalProperties,false);assert.equal(called,0);
 await assert.rejects(createBusinessDispatcher({config,access:{}}).execute('run_business_query',{operation:'read_employee_directory',arguments_json:'{"mode":"unknown"}'}),{code:'business_read_denied'});
});

test('query dimensions never masquerade as executable mode values',()=>{
 assert.deepEqual(employeeDirectoryRead.moduleInterface.query.modes,['summary','list','detail']);
 assert(employeeDirectoryRead.moduleInterface.query.dimensions.includes('count'));
 assert.equal(operations.find(o=>o.id==='read_operational_financials').moduleInterface.query.modes,null);
});
test('malformed inner JSON can be corrected on Text/Voice without executing a domain read or bypassing policy',async()=>{
 const operation='read_factory_raw_catalogue';
 const arguments_={operation,arguments_json:'{"mode":"list","sort":'};
 const config={enabled:true,capability_connections:{[operation]:true}};
 const access={permissions:{'factory_raw_inventory.view':true}};
 const noRead=()=>assert.fail('Invalid query reached the domain source');
 const business=createBusinessDispatcher({config,access,caller:{rpc:noRead,from:noRead}});
 const feedback=await business.execute('run_business_query',arguments_,undefined,{withOutcome:true});
 assert.equal(feedback.error,'tool_arguments_invalid');
 assert.equal(feedback.operation,operation);
 assert.equal(feedback.not_business_evidence,true);
 assert.deepEqual(feedback.parameters.properties.sort.enum,['name','balance_desc','balance_asc']);
 const identity='10000000-0000-4000-8000-000000000001';
 const request={action:'realtime_tool',session_id:identity,request_id:identity,turn_id:identity,provider:'openai',
  operation:'run_business_query',arguments:arguments_};
 const deps={access,get:()=>undefined,rpc:async()=>({config}),reserveRealtime:async()=>{},voiceHistory:noRead};
 assert.deepEqual(await dispatch(request,deps),feedback);
 await assert.rejects(dispatch(request,{...deps,access:{}}),{code:'business_read_denied'});
 await assert.rejects(dispatch(request,{...deps,rpc:async()=>({config:{enabled:true}})}),{code:'capability_disconnected'});
 await assert.rejects(dispatch({...request,arguments:{...arguments_,extra:true}},deps),{code:'tool_arguments_invalid'});
});

test('operational Finance validates the actual source scope and period and reconciles drivers before attribution',async()=>{
 const operation=operations.find(o=>o.id==='read_operational_financials');
 const outlet='20000000-0000-4000-8000-000000000001';
 const periods={3:[100,40,10,50],4:[120,43,25,52]};
 const args={outlet_id:outlet,year:2026,month:4,compare_year:2026,compare_month:3};
 let wrongPeriod=false,wrongOutlet=false;
 const caller={rpc(name,p){
  if(name==='current_user_has_permission')return {abortSignal:async()=>({data:true})};
  assert.equal(name,'reporting_monthly_scope_financials');
  const financials=Object.fromEntries(['revenue','purchase_based_cogs','opex','net_profit'].map((key,index)=>{
   const amount=periods[p.p_month][index];
   return [key,{amount,presence:amount===null?'missing':'present'}];
  }));
  return {abortSignal:async()=>({data:{outlet:{id:wrongOutlet?null:outlet,scope:'outlet',outlet_count:1},
   period:{year:2026,month:wrongPeriod?2:p.p_month},financials}})};
 }};
 const read=async()=>operation.execute(caller,args);
 let {analysis}=await read();
 assert.equal(analysis.purchase_based_cogs_change_myr,3);
 assert.equal(analysis.recorded_opex_change_myr,15);
 assert.equal(analysis.revenue_growth_percent,20);
 assert.equal(analysis.performance_zone,'Growing & profitable');
 assert.deepEqual(analysis.ebitda_contributions_myr,{revenue:20,purchase_based_cogs:-3,recorded_opex:-15});
 periods[4][3]=50;
 assert.equal((await read()).analysis.ebitda_contributions_myr,null);
 periods[4][2]=null;
 analysis=(await read()).analysis;
 assert.equal(analysis.recorded_opex_change_myr,null);
 assert.equal(analysis.purchase_based_cogs_change_myr,3);
 assert.equal(analysis.ebitda_contributions_myr,null);
 wrongPeriod=true;
 await assert.rejects(operation.execute(caller,{outlet_id:outlet,year:2026,month:4}),{code:'business_read_unavailable'});
 wrongPeriod=false;wrongOutlet=true;
 await assert.rejects(read(),{code:'business_read_unavailable'});
});

for(const raw of [false,true])test('Factory '+(raw?'raw material':'finished product')+' history retains canonical units, filter identity and exact count on subsequent pages',async()=>{
 const operation=operations.find(o=>o.id===(raw?'read_factory_raw_movements':'read_factory_product_movements'));
 const calls=[];
 const record={id:'row-21',item_name:'Canonical item',item_code:'CM-1',quantity:-4,uom:'kg',balance_after:12,movement_date:'2026-09-01',
  created_at:'2026-09-01T12:00:00Z',batch_no:'B11',notes:'NON_PUBLIC',created_by:'NON_PUBLIC'};
 const caller={rpc(name,params,options){
  if(name==='current_user_has_permission')return {abortSignal:async()=>({data:true})};
  assert.equal(name,raw?'factory_list_raw_material_movements':'factory_list_product_movements');
  assert.deepEqual(options,{count:'exact'});
  assert.equal(params.p_date_from,'2026-09-01');assert.equal(params.p_date_to,'2026-09-20');
  const q={
   select(fields){assert(!fields.includes('notes'));assert(fields.includes('uom')||fields==='id');return this;},
   ilike(field,value){calls.push([field,value]);return this;},order(field){calls.push(field);return this;},
   range(start,end){calls.push([start,end]);return this;},limit(n){calls.push(['limit',n]);return this;},
   abortSignal:async()=>({data:[record],count:21}),
  };
  return q;
 }};
 const args={from:'2026-09-01',to:'2026-09-20',sku:'CM-1',batch:'B11',page:2};
 const result=await operation.execute(caller,args);
 assert.equal(result.total_matching,21);assert.equal(result.page,2);assert.equal(result.truncated,false);
 assert.deepEqual(result.rows.map(r=>[r.item_name,r.item_code,r.quantity,r.uom,r.balance_after]),[['Canonical item','CM-1',-4,'kg',12]]);
 assert.equal(result.rows[0].quantity_unit,raw?'kg':'Pack');
 assert(!JSON.stringify(result).includes('NON_PUBLIC'));
 assert.deepEqual(calls,[[raw?'raw_material->>material_code':'finished_good->>product_code','CM-1'],['batch_no','B11'],
  'movement_date','created_at','id',[20,39]]);
 calls.length=0;
 const summary=await operation.execute(caller,{...args,page:1,mode:'summary'});
 assert.equal(summary.total_matching,21);assert.equal(summary.rows.length,0);assert.deepEqual(calls.at(-1),['limit',1]);
});

test('directory and purchase pages count the same restricted rows, retaining authorized labels and stable purchase ranks',async()=>{
 const log=[];
 const outlet='10000000-0000-4000-8000-000000000001';
 const other='10000000-0000-4000-8000-000000000002';
 const records=Array.from({length:24},(_,i)=>({id:String(i+1).padStart(2,'0'),name:'Entry '+i,is_active:i%2===0,
  outlet_id:i===23?other:outlet,year:2026,month:i===22?9:10,amount:i===1?2:i,
  supplier:{name:'Supplier '+i,category:'Old category',private_note:'PRIVATE'},
  category:i===21?null:{name:'Category'},remark:'PRIVATE'}));
 function caller(canRead=true,canUseOutlet=true){
  return {rpc:name=>({abortSignal:async()=>({data:name==='current_user_can_access_outlet'?canUseOutlet:canRead})}),
   from(table){
    log.push(table);
    let filtered=records,head=false,range=null;
    const order=[];
    const q={
     select(columns,options){head=options?.head;return q;},
     eq(k,v){filtered=filtered.filter(r=>r[k]===v);return q;},
     ilike(k,v){filtered=filtered.filter(r=>r[k]?.toLowerCase()===v.toLowerCase());return q;},
     order(k,options){order.push([k,options?.ascending!==false]);return q;},
     range(a,b){range=[a,b+1];return q;},
     async abortSignal(){
      const sorted=[...filtered].sort((a,b)=>{
       for(const [k,asc] of order){if(a[k]!==b[k])return (a[k]<b[k]?-1:1)*(asc?1:-1);}
       return 0;
      });
      return {count:filtered.length,data:head?null:range?sorted.slice(...range):sorted};
     },
    };
    return q;
   }};
 }
 for(const id of ['read_outlet_directory','read_sales_channels','read_purchase_categories','read_supplier_directory','read_factory_equipment']){
  const op=operations.find(o=>o.id===id);
  const active=op.tool.parameters.properties.status?{status:'active'}:{};
  const e=await op.execute(caller(),{mode:'summary',page:1,...active});
  assert.equal(e.total_matching,active.status?12:24);assert.deepEqual(e.rows,[]);
  const pageTwo=await op.execute(caller(),{page:2});
  assert.equal(pageTwo.total_matching,24);assert.equal(pageTwo.rows.length,4);assert.equal(pageTwo.truncated,false);
  const before=log.length;await assert.rejects(op.execute(caller(false),{page:1}),{code:'business_read_denied'});assert.equal(log.length,before);
 }
 const op=operations.find(o=>o.id==='read_purchase_records');
 const scope={page:1,month:'2026-10-01',outlet_id:outlet,sort:'amount_desc',mode:'list'};
 const result=await op.execute(caller(),scope);
 assert.equal(result.total_matching,22);
 assert.deepEqual(result.rows.slice(0,2).map(row=>[row.amount,row.supplier_name,row.category_name]),[
  [21,'Supplier 21','Old category'],[20,'Supplier 20','Category'],
 ]);
 assert.equal(result.rows.length,20);assert.equal(result.truncated,true);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 const second=await op.execute(caller(),{...scope,page:2});
 assert.equal(second.total_matching,22);assert.equal(second.rows.length,2);assert.equal(second.truncated,false);
 const before=log.length;await assert.rejects(op.execute(caller(true,false),scope),{code:'business_read_denied'});assert.equal(log.length,before);
});
