import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {operations,createBusinessDispatcher,queryTool} from './business.js';
import {dispatch} from './handler.js';
import {generateText} from './provider.js';
import {createSdkVoiceHistory} from '../../../src/features/ai-assistant/sdkVoiceHistory.js';
import {rawMaterialStockStatus} from '../_shared/factory/stockCatalogue.js';
import {failureOutcome,outcomeFor,outletContinuation} from './businessQuery.js';

const reads=operations.filter(o=>o.kind==='READ');
const id='10000000-0000-4000-8000-000000000001';
const otherId='10000000-0000-4000-8000-000000000002';
const config={revision:1,enabled:true,provider:'openai',model:'gpt-4o-mini',credential_ref:'native-assistant-openai',
 capability_connections:Object.fromEntries(reads.map(o=>[o.id,true]))};
const access={factory:true,permissions:Object.fromEntries(reads.map(o=>[o.permission,true]))};
const envelope=(operation,args)=>({operation,arguments_json:JSON.stringify(args)});
const voiceRequest=(operation,args)=>({action:'realtime_tool',provider:'openai',session_id:id,
 request_id:id,turn_id:id,operation,arguments:args});
function argsFor(op){
 return Object.fromEntries(Object.entries(op.tool.parameters.properties).map(([key,schema])=>{
  const value=schema.type.includes('null')?null:schema.type==='array'?[]:schema.enum?schema.enum[0]:
   ['integer','number'].includes(schema.type)?schema.minimum??1:
    key.includes('id')?id:key==='to'?'2026-11-02':key==='query'?'':'2026-11-01';
  return [key,value];
 }));
}

for(const op of reads)test(`${op.id}: discovery, argument fencing, AI policy and human denial`,async()=>{
 const business=createBusinessDispatcher({config,access});
 const discovered=await business.execute('find_business_queries',{search:op.id,page:1});
 const exposed=discovered.operations.find(row=>row.operation===op.id);
 assert.deepEqual(exposed?.parameters,queryTool(op).parameters);
 assert.equal(exposed?.module,op.module_id);
 assert.equal(discovered.not_business_evidence,true);
 const byBusinessLabel=await business.execute('find_business_queries',{search:op.label.slice(0,80),page:1});
 assert(byBusinessLabel.operations.some(row=>row.operation===op.id),'The documented business label must surface its operation');
 const args=argsFor(op);
 op.validate(args);
 const noSource=()=>assert.fail('Denied read reached a domain source');
 const gated=createBusinessDispatcher({config,access,loadConfig:async()=>({...config,capability_connections:{}}),
  caller:{rpc:noSource,from:noSource}});
 await assert.rejects(gated.execute('run_business_query',envelope(op.id,args)),{code:'capability_disconnected'});
 assert(!((await gated.execute('find_business_queries',{search:op.id,page:1})).operations.length));
 const denied=createBusinessDispatcher({config,access:{},caller:{rpc:noSource,from:noSource}});
 await assert.rejects(denied.execute('run_business_query',envelope(op.id,args)),{code:op.deniedCode});
 const invalid=await business.execute('run_business_query',envelope(op.id,{...args,sql:'select *'}));
 assert.equal(invalid.error,'tool_arguments_invalid');
 assert.equal(invalid.operation,op.id);
 assert.equal(invalid.no_evidence,true);
});

// Representative fixed source results. The scripted provider exercises the
// real shared orchestration; human-identifiable Staging rows do not live in Git.
const employee={summary:{total:6,active:4,inactive:2,resigned:2,terminated:0,other:0},
 employment_types:{full_time:2,part_time:1,probation:2,contract:1},rows:[],total_count:6,
 page:1,page_size:20,aggregate_complete:true,schema_version:2,as_of:'fixture'};
const finance={period:{year:2026,month:11},financial_completeness:'incomplete',
 financials:{revenue:{amount:125,presence:'present'},purchase_based_cogs:{amount:null,presence:'missing'},
  net_profit:{amount:null,presence:'missing'}}};
const leave={total_count:24,rows:[{id,status:'approved',start_date:'2026-11-01',reason:'DO_NOT_EXPOSE'}]};
const plan={tasks:[{id,title:'Fixture task',status:'completed',review_feedback:'DO_NOT_EXPOSE'}]};
const sales=[{id,outlet_id:id,year:2026,month:11,amount:125,remark:'DO_NOT_EXPOSE'}];
const outlets=[{id,name:'Fixture Corner',code:'FC',is_active:true},{id:otherId,name:'Different Outlet',code:'DO',is_active:true}];
const assets=[
 {id:'spoon',outlet_id:id,name:'Spoon',asset_code:null,current_quantity:15,unit:'unit',status:'active',supplier:'DO_NOT_EXPOSE'},
 {id:'fork',outlet_id:id,name:'Fork',asset_code:'FORK-1',current_quantity:0,unit:'unit',status:'active'},
 {id:'archived',outlet_id:id,name:'Spoon',current_quantity:500,unit:'unit',status:'archived'},
 {id:'different',outlet_id:otherId,name:'Spoon',current_quantity:900,unit:'unit',status:'active'},
];
const fixtures={
 employee_directory_query:employee,reporting_monthly_scope_financials:finance,
 crew_leave_requests_admin_page:leave,marketing_planner_read:plan,
};
const stock=Array.from({length:26},(_,i)=>({id:`item-${i}`,product_code:`FG-${i}`,material_code:`RM-${i}`,
 product_name:`Product ${i}`,name:`Material ${i}`,status:'active',uom:'kg',current_balance:i,
 min_stock_level:5,manual_unit_cost:'DO_NOT_EXPOSE'})).concat({id:'mixed',uom:'ml',current_balance:999,status:'active'});

function source({scope=true,brand=true,snapshot,assetRows=assets,outletRows=outlets,inventoryRows=[],inventoryError}={}){
 const calls=[];
 const caller={
  rpc(name,args){
   calls.push([name,args]);
   let result={data:(snapshot?.rpcs||fixtures)[name]};
   if(name==='current_user_role_id')result={data:'owner'};
   if(name==='current_user_has_permission')result={data:true};
   if(name==='current_user_can_access_outlet')result={data:scope};
   if(name==='factory_get_master_id_snapshot'){
    const table=args.p_entity==='finished_goods'?'factory_finished_goods':'factory_raw_materials';
    result={data:(snapshot?.tables[table]||stock).map(r=>r.id)};
   }
   if((name==='marketing_planner_read'&&!brand)||(name==='crew_leave_requests_admin_page'&&!scope))result={error:{code:'42501'}};
   return {...result,abortSignal:async()=>result};
  },
  from(table){
   calls.push([table]);
   if(['outlets','asset_items','inventory_items'].includes(table)){
    let rows=table==='outlets'?outletRows:table==='asset_items'?assetRows:inventoryRows;
    let head=false;
    const builder={
     select(fields,options){head=options?.head;if(table==='inventory_items')assert.match(fields,/inventory_item_outlets!inner/);return this;},
     in(field,values){assert.equal(field,'inventory_item_outlets.outlet_id');rows=rows.filter(row=>row.outlets.some(outlet=>values.includes(outlet)));return this;},
     eq(field,value){rows=rows.filter(row=>row[field]===value);return this;},
     neq(field,value){rows=rows.filter(row=>row[field]!==value);return this;},
     ilike(field,pattern){rows=rows.filter(row=>row[field]?.toLowerCase()===pattern.replace(/\\([%_\\])/g,'$1').toLowerCase());return this;},
     limit(max){rows=rows.slice(0,max);return this;},
     order(){return this;},
     range(start,end){rows=rows.slice(start,end+1);return this;},
     abortSignal:async()=>table==='inventory_items'&&inventoryError?{error:{code:'57014'}}:{data:head?null:rows,count:rows.length},
    };
    return builder;
   }
   let included;
   const builder=new Proxy({}, {get:(_,method)=>method==='abortSignal'
    ?async()=>({data:(snapshot?.tables[table]||(table==='sales_records'?sales:stock)).filter(row=>!included||included.includes(row.id))})
    :(...values)=>{calls.push([method,...values]);if(method==='in')included=values[1];return builder;}});
   return builder;
  },
 };
 return {caller,calls};
}

const cases=[
 ['read_factory_finished_goods','Rank FG stock in kg',{mode:'list',sort:'balance_desc',uom:'kg'},r=>assert.equal(r.rows[0].product_code,'FG-25')],
 ['read_factory_raw_catalogue','Rank active RM by lowest stock in kg',{mode:'list',status:'active',sort:'balance_asc',uom:'kg'},r=>assert.equal(r.rows[0].material_code,'RM-0')],
 ['read_employee_directory','Count employees by status and type',{mode:'summary'},r=>{assert.deepEqual(r.summary,employee.summary);assert.deepEqual(r.employment_types,employee.employment_types);}],
 ['read_asset_catalogue','What is the current balance of asset-spoon at Fixture Corner?',{mode:'detail',outlet_name:'Fixture Corner',query:'asset-spoon'},r=>{
  assert.equal(r.match_status,'matched');assert.equal(r.matched_by,'name');
  assert.equal(r.outlet.code,'FC');assert.deepEqual(r.rows.map(row=>[row.name,row.current_quantity,row.unit]),[['Spoon',15,'unit']]);
 }],
 ['read_crew_leave','How many leave requests overlapped these dates?',{outlet_id:id,from:'2026-11-01',to:'2026-11-02'},r=>{assert.equal(r.total_matching,24);assert.equal(r.rows.length,1);}],
 ['read_sales_records','Show monthly sales input for this outlet',{outlet_id:id,month:'2026-11-01',page:1},r=>{assert.equal(r.rows[0].amount,125);assert.equal(r.completeness.aggregate_scope,'not_asserted');}],
 ['read_operational_financials','What finance figures exist for this reporting period?',{outlet_id:id,year:2026,month:11},r=>assert.deepEqual(r.report,finance)],
 ['read_marketing_plan','How many tasks are in this Brand planning month?',{organization_id:id,brand_id:id,month:'2026-11-01'},r=>assert.equal(r.total_matching,1)],
];
const response=output=>Response.json({status:'completed',output,usage:{input_tokens:100,output_tokens:10}});
const functionCall=(name,args,call_id)=>({type:'function_call',name,call_id,arguments:JSON.stringify(args)});

test('multilingual per-outlet inventory counts use complete Master Inventory results without invoking a model',async()=>{
 const operation='read_inventory_items';
 const inventoryRows=[
  {id:'a',status:'active',outlets:[id,otherId]},
  {id:'b',status:'active',outlets:[id]},
  {id:'c',status:'inactive',outlets:[otherId]},
  {id:'d',status:'active',outlets:['denied-outlet']},
 ];
 const src=source({inventoryRows});
 const business=createBusinessDispatcher({caller:src.caller,config,access});
 const questions=['餐厅每个门店目前有多少种库存品项？','Berapa jenis item inventori restoran untuk setiap cawangan?',
  'How many Master Inventory item types are there at each outlet?',
  'How many Master Inventory items are there at Fixture Corner and Different Outlet?'];
 for(const prompt of questions){
  let evidence;
  const result=await generateText({kind:'turn',model:config.model,prompt},'fixture-secret',{business,
   onTool:(state,value)=>{if(state==='completed')evidence=value;},transport:()=>assert.fail('Unnecessary model call')});
  assert.equal(result.input_tokens,0);
  assert.equal(evidence.capability,operation);
  assert.equal(evidence.aggregate_complete,true);
  assert.deepEqual(evidence.by_outlet.map(row=>[row.outlet.id,row.total_matching]),[[id,2],[otherId,1]]);
  assert.match(result.reply,/Fixture Corner: 2/);
  assert.match(result.reply,/Different Outlet: 1/);
  assert.doesNotMatch(result.reply,/outlet_id|read_inventory_items/);
 }
 const prompt='How many Restaurant Inventory items are there?';
 const overall=await business.execute(operation,{},undefined,{prompt,withOutcome:true});
 assert.equal(overall.total_matching,2,'One item linked to both outlets counts once in a distinct total');
 const unavailable=source({inventoryRows,inventoryError:true});
 const recovered=await generateText({kind:'turn',model:config.model,prompt},'fixture-secret',{
  business:createBusinessDispatcher({caller:unavailable.caller,config,access}),
  onTool:(state,value)=>{assert.notEqual(state,'completed');assert.equal(value,undefined);},
  transport:()=>assert.fail('No paid fallback for a failed read'),
 });
 assert.match(recovered.reply,/could not be read/);
 const restricted=source({inventoryRows,scope:false});
 const denied=createBusinessDispatcher({caller:restricted.caller,config,access});
 await assert.rejects(denied.execute(operation,{},undefined,{prompt,withOutcome:true}),{code:'business_read_denied'});
 assert(!restricted.calls.some(([name])=>name==='inventory_items'));
 assert(!business.plan('How many Factory raw material inventory items are there?'));
 assert.notEqual(business.plan('List Restaurant Inventory Movements at Fixture Corner')?.operation,operation);
 assert(!business.plan('How many Restaurant Inventory items are there, and how many HR employees?'));
});

test('the same Text and Voice pipeline resolves a short outlet correction after a failed transcript',async()=>{
 const operation='read_asset_catalogue';
 const prompt='Fixture Corner';
 const src=source({outletRows:[{...outlets[0],name:'Fixture Corner Ipoh'},outlets[1]]});
 const business=createBusinessDispatcher({caller:src.caller,config,access});
 const previous={state:'completed',prompt:'How many assets are at Ficture Café? Give balances for each asset.',reply:'An earlier guess.',tool_state:'failed'};
 const history=async()=>({turns:[previous]});
 let saved;
 const text=await generateText({kind:'turn',model:config.model,prompt},'fixture-secret',{business,history,
  onTool:(state,value)=>{if(state==='completed')saved=value;},transport:()=>assert.fail('No model needed for a resolved correction')});
 assert.match(text.reply,/Fixture Corner Ipoh has 2 current asset records/);
 assert.match(text.reply,/Spoon: 15 unit/);
 assert.match(text.reply,/Fork: 0 unit/);
 let voiceEvidence;
 const voice=await dispatch(voiceRequest(operation,{mode:'detail',query:'Spoon',outlet_name:'Different Outlet'}),{
  caller:src.caller,access,get:()=>undefined,async rpc(action){
   if(action==='history')return {turns:[previous,{request_id:id,voice_input_available:true,prompt,state:'running'}]};
   return {config};
  },reserveRealtime:async()=>{},voiceHistory:async payload=>{voiceEvidence=payload.evidence;},
 });
 assert.equal(voice.answer_hint,text.reply);
 assert.deepEqual(voiceEvidence.outlet,saved.outlet);
 assert.deepEqual(voiceEvidence.rows,saved.rows);
 assert.equal(voiceEvidence.total_matching,2);
 await assert.rejects(business.execute('read_inventory_items',{page:1},undefined,{prompt,history}),{code:'tool_not_allowed'});
});
test('operational revenue discovers Finance and reads the named outlet for the requested month',async()=>{
 const operation='read_operational_financials';
 const prompt='What was the recorded operational revenue for Fixture Corner in January 2026? Use the Finance monthly financials in MYR and cite the outlet and month.';
 const src=source();
 const business=createBusinessDispatcher({caller:src.caller,config,access});
 const discovery=await business.execute('find_business_queries',{search:'Finance monthly revenue for Fixture Corner',page:1});
 assert(discovery.operations.some(item=>item.operation===operation));
 let calls=0;
 const result=await generateText({kind:'turn',model:config.model,prompt},'fixture-secret',{business,transport:async(_,init)=>{
  const body=JSON.parse(init.body);
  if(calls++===0){
   assert(body.tools.some(tool=>tool.name===operation));
   return response([functionCall(operation,{outlet_id:null,outlet_name:'Fixture Corner',year:2026,month:1},'finance')]);
  }
  const evidence=JSON.parse(body.input.at(-1).output);
  assert.equal(evidence.capability,operation);
  assert.deepEqual(evidence.requested_scope,{outlet_id:id,year:2026,month:1});
  assert.equal(evidence.report.financials.revenue.amount,125);
  return response([{type:'message',content:[{type:'output_text',text:'Fixture Corner recorded MYR 125 in operational revenue in January 2026.'}]}]);
 }});
 assert.match(result.reply,/MYR 125/);
 assert(src.calls.some(([name,params])=>name==='reporting_monthly_scope_financials'&&params.p_outlet_id===id&&params.p_month===1));
});
for(const [operation,question,args,check] of cases)test(`${operation}: evidence through Text orchestration and SDK handoff`,async()=>{
 const {caller}=source();
 const business=createBusinessDispatcher({caller,config,access});
 let n=0;
 let textEvidence;
 const reply=await generateText({prompt:question,kind:'turn',model:config.model,assembled:{recent:[{
  prompt:'Use the same scope for the follow-up',reply:'[Historical business answer omitted.]',
 }]}},'fixture-secret',{
  business,onTool:(state,evidence)=>{if(state==='completed')textEvidence=evidence;},
  transport:async(_,init)=>{
   const body=JSON.parse(init.body);
   assert(body.input.some(message=>message.content===question));
   if(++n===1)return response(operation==='read_asset_catalogue'?[functionCall(operation,args,'query')]:[functionCall('find_business_queries',{search:operation,page:1},'discover')]);
   if(n===2&&operation!=='read_asset_catalogue'){
    assert.equal(JSON.parse(body.input.at(-1).output).operations[0].operation,operation);
    return response([functionCall('run_business_query',envelope(operation,args),'query')]);
   }
   const value=JSON.parse(body.input.at(-1).output);
   check(value);
   assert.equal(value.capability,operation);
   assert.doesNotMatch(JSON.stringify(value),/DO_NOT_EXPOSE/);
   return response([{type:'message',content:[{type:'output_text',text:'The authorized result is attached.'}]}]);
  },
 });
 if(operation==='read_asset_catalogue')assert.match(reply.reply,/15 unit/);
 else assert.equal(reply.reply,'The authorized result is attached.');
 check(textEvidence);
 const persisted=[],writes=[];
 const history=createSdkVoiceHistory({id:()=>id,state(){},trace(){},write:async(...steps)=>writes.push(steps),
  read:(_,params,tool)=>dispatch(voiceRequest(tool,params),{caller,access,get:()=>undefined,
   rpc:async()=>({config}),reserveRealtime:async action=>assert.equal(action,'tool'),
   voiceHistory:async payload=>persisted.push(payload.evidence)})});
 history.receive({type:'input_audio_buffer.committed',item_id:'input'});
 history.receive({type:'response.created',response:{id:'tool'}});
 const {result}=await history.tool(envelope(operation,args),'tool','run_business_query');
 check(result);
 assert.deepEqual(persisted,[result]);
 const withoutReadTime=({as_of,...evidence})=>evidence;
 assert.deepEqual(withoutReadTime(result),withoutReadTime(textEvidence));
 history.receive({type:'response.done',response:{id:'tool',status:'completed',output:[{type:'function_call'}]}});
 history.receive({type:'response.created',response:{id:'answer'}});
 history.receive({type:'response.done',response:{id:'answer',status:'completed',output:[
  {role:'assistant',content:[{type:'output_audio',transcript:'The authorized result is attached.'}]},
 ]}});
 await history.close();
 assert.equal(writes.at(-1)[1],'complete');
});

test('populated catalogue ranks before pagination, keeps same-unit boundaries, and shares RM low-stock semantics',async()=>{
 const b=createBusinessDispatcher({config,access,caller:source().caller});
 const operation='read_factory_raw_catalogue';
 const list={mode:'list',sort:'balance_desc',status:'active'};
 const mixed=await b.execute(operation,list);
 assert.equal(mixed.ranking.status,'unit_required');
 assert.deepEqual(mixed.rows,[]);
 const second=await b.execute(operation,{...list,uom:'kg',page:2});
 assert.equal(second.ranking.ranked_count,26);
 assert.equal(second.rows.length,6);
 assert.equal(second.rows[0].material_code,'RM-5');
 const low=await b.execute(operation,{mode:'summary',availability:'low',uom:'kg',status:'active'});
 assert.equal(rawMaterialStockStatus(5,5),'Low Stock');
 assert.equal(low.total_matching,5);
 const good=await b.execute('read_factory_finished_goods',{mode:'summary',uom:'kg'});
 assert.equal(good.low_stock_count,5);
 assert.doesNotMatch(JSON.stringify(second),/DO_NOT_EXPOSE/);
});

test('natural discovery ignores query verbs, handles domain aliases, and never surfaces unauthorized matches',async()=>{
 const b=createBusinessDispatcher({config,access});
 for(const [search,operation] of [['top FG stock','read_factory_finished_goods'],['highest raw material stock','read_factory_raw_catalogue'],
  ['highest active raw materials in kg','read_factory_raw_catalogue'],
  ['员工','read_employee_directory'],['HR employees','read_employee_directory'],['Restaurant sales input','read_sales_records'],['marketing plan','read_marketing_plan'],
  ['Which three raw materials have the highest balances in kg?','read_factory_raw_catalogue'],
  ['How many finished goods are below minimum?','read_factory_finished_goods'],
  ['Give me employee headcount by employment-status in my scope','read_employee_directory'],
  ['帮我查看Friends Corner的asset-spoon目前有多少balance','read_asset_catalogue'],
  ['What is the current balance of asset-spoon at Friends Corner?','read_asset_catalogue']]){
  const result=await b.execute('find_business_queries',{search,page:1});
  assert.equal(result.operations[0]?.operation,operation,search);
 }
 for(const search of ['unrelated astronomy','最高','recalculate employee salary']){
  assert(!((await b.execute('find_business_queries',{search,page:1})).operations.length));
 }
});

test('cross-outlet and cross-brand rejection create no business evidence',async()=>{
 const b=createBusinessDispatcher({config,access,caller:source({scope:false,brand:false}).caller});
 for(const [id,,args] of cases.filter(([name])=>/crew_leave|sales_records|marketing_plan/.test(name))){
  await assert.rejects(b.execute('run_business_query',envelope(id,args)),{code:'business_read_denied'});
 }
 const missing=createBusinessDispatcher({config,access,caller:{rpc:name=>({abortSignal:async()=>({data:name==='current_user_has_permission'?true:null})})}});
 await assert.rejects(missing.execute('read_employee_directory',{mode:'summary'}),{code:'business_read_unavailable'});
});

test('asset counts, exact codes and ambiguous names use only the authorized current outlet',async()=>{
 const operation='read_asset_catalogue';
 const {caller}=source();
 const business=createBusinessDispatcher({config,access,caller});
 const summary=await business.execute(operation,{outlet_name:'FC',mode:'summary'});
 assert.deepEqual([summary.total_matching,summary.aggregate_complete,summary.rows.length],[2,true,0]);
 const zero=await business.execute(operation,{outlet_id:id,mode:'detail',query:'fork-1'});
 assert.deepEqual([zero.matched_by,zero.rows[0].current_quantity],['asset_code',0]);
 const missing=await business.execute(operation,{outlet_id:id,mode:'detail',query:'unknown'});
 assert.equal(missing.match_status,'not_found');assert.deepEqual(missing.rows,[]);
 const escaped=await business.execute(operation,{outlet_id:id,mode:'detail',query:'%'});
 assert.equal(escaped.match_status,'not_found');
 const ambiguous=createBusinessDispatcher({config,access,caller:source({assetRows:[...assets,{...assets[0],id:'second-spoon'}]}).caller});
 const duplicate=await ambiguous.execute(operation,{outlet_name:'FC',mode:'detail',query:'asset-spoon'});
 assert.equal(duplicate.match_status,'ambiguous');assert.deepEqual(duplicate.rows,[]);
 const denied=source({scope:false});
 const restricted=createBusinessDispatcher({config,access,caller:denied.caller});
 for(const scope of [{outlet_name:'FC'},{outlet_id:id}]){
  await assert.rejects(restricted.execute(operation,{...scope,mode:'detail',query:'asset-spoon'}),{code:'business_read_denied'});
 }
 assert(!denied.calls.some(([source])=>source==='asset_items'));
});

test('auth-owned Text entry point grounds an explicit correction after a failed Voice turn and long history',async()=>{
 const operation='read_asset_catalogue';
 const question='你不懂Fixture Corner的汤匙剩多少？';
 const stale={voice:true,seq:30,prompt:'Different Outlet资产spoon余额',state:'completed',tool_state:'failed',
  reply:'The asset might not be registered.',evidence:null};
 const src=source();
 const previous=[...Array.from({length:29},(_,i)=>({seq:i+1,prompt:'Older discussion '+i,reply:'Unrelated conversation'})),stale];
 const flags={NATIVE_ASSISTANT_OPENAI_API_KEY:'fixture-not-real',NATIVE_ASSISTANT_APPROVED_USE:'native-assistant-phase1a',
  NATIVE_ASSISTANT_APPROVAL_REFERENCE:'fixture',NATIVE_ASSISTANT_MODELS:'gpt-4o-mini'};
 let evidence,toolCalls=0,finish;
 const result=await dispatch({action:'respond',session_id:id,turn_id:otherId},{
  caller:src.caller,access,get:key=>flags[key],
  async rpc(action,values){
   if(action==='status')return {config};
   if(action==='claim')return {kind:'turn',prompt:question,model:config.model,state:'running',lease_id:id};
   if(action==='context_snapshot')return {context:previous,fingerprint:'owned-history'};
   if(action==='memory_get')return {memory:{}};
   if(action==='tool_record'&&values.evidence)evidence=values.evidence;
   if(action==='finish'){finish=values;return {state:'completed',reply:values.reply};}
   return {};
  },
  async transport(_,init){
   const body=JSON.parse(init.body);
   assert.doesNotMatch(JSON.stringify(body),/Different Outlet资产|not be registered/);
   if(toolCalls++===0){
    assert.deepEqual(body.tool_choice,{type:'function',name:operation});
    return response([functionCall(operation,{mode:'summary',query:'汤匙',outlet_id:otherId,outlet_name:'Different Outlet'},'plan')]);
   }
   if(toolCalls===2){
    const pending=JSON.parse(body.input.at(-1).output);
    assert.equal(pending.query_outcome,'AMBIGUOUS');
    assert.deepEqual(pending.candidates.map(record=>record.name),['Spoon','Fork']);
    assert(pending.not_business_evidence&&!pending.rows);
    assert.deepEqual(body.tool_choice,{type:'function',name:operation});
    return response([functionCall(operation,{mode:'detail',query:'Spoon',outlet_name:'Fixture Corner'},'canonical-name')]);
   }
   assert.equal(JSON.parse(body.input.at(-1).output).outlet.id,id);
   return response([{type:'message',content:[{type:'output_text',text:'Unverified 99 units.'}]}]);
  },
 });
 assert.match(result.reply,/Fixture Corner.+Spoon.+15 unit/);
 assert.doesNotMatch(result.reply,/99/);
 assert.equal(evidence.query_outcome,'SUCCESS');
 assert.equal(finish.context_usage.source_turns,30);
});

test('Text and Voice bind only explicit or compatible confirmed outlet scope',async()=>{
 const operation='read_asset_catalogue',args={mode:'detail',query:'Spoon',outlet_id:otherId};
 const src=source();
 const business=createBusinessDispatcher({config,access,caller:src.caller});
 const old=await business.execute(operation,{...args,outlet_id:id},undefined,{withOutcome:true});
 const history=async()=>({turns:[
  {state:'completed',tool_state:'completed',evidence:old},
  {state:'completed',tool_state:'failed',evidence:{...old,outlet:{id:otherId}}},
 ]});
 const follow=await business.execute(operation,args,undefined,{prompt:'How many Spoon units at that outlet?',history,withOutcome:true});
 assert.equal(follow.outlet.id,id);
 assert.equal(follow.rows[0].current_quantity,15);
 const voice=await dispatch(voiceRequest('run_business_query',envelope(operation,args)),{
  caller:src.caller,access,get:()=>undefined,async rpc(action){
   if(action==='history')return {turns:[...(await history()).turns,{request_id:id,voice_input_available:true,prompt:'What is the spoon balance at Fixture Corner?'}]};
   return {config};
  },reserveRealtime:async()=>{},voiceHistory:async()=>{},
 });
 assert.equal(voice.outlet.id,id);assert.equal(voice.rows[0].current_quantity,15);
 assert.equal(voice.query_outcome,'SUCCESS');
 await assert.rejects(business.execute(operation,args,undefined,{prompt:'How many Spoon units at Unknown Corner?',history}),{code:'entity_scope_required'});
 assert.equal(outletContinuation('Give leave at that outlet, also show monthly regional finance.'),false);
});

test('named scopes reauthorize before the domain call and preserve distinct query outcomes',async()=>{
 const operation='read_asset_catalogue';
 const src=source();
 const granted=createBusinessDispatcher({config,access,caller:src.caller});
 const args={mode:'detail',outlet_name:'Fixture—Corner',query:'missing item'};
 const missing=await granted.execute(operation,args,undefined,{withOutcome:true});
 assert.equal(missing.query_outcome,'NO_MATCH');assert.equal(missing.outlet.id,id);
 assert.equal(failureOutcome('entity_ambiguous'),'AMBIGUOUS');
 assert.equal(failureOutcome('business_read_denied'),'UNAUTHORIZED');
 assert.equal(failureOutcome('tool_arguments_invalid'),'UNSUPPORTED');
 assert.equal(failureOutcome('business_read_unavailable'),'EXECUTION_ERROR');
 assert.equal(outcomeFor({rows:[],truncated:true}),'SUCCESS');
 const denied=source({scope:false});
 const restricted=createBusinessDispatcher({config,access,caller:denied.caller});
 await assert.rejects(restricted.execute('read_crew_leave',{outlet_name:'Fixture Corner',from:'2026-11-01',to:'2026-11-02'}),{code:'business_read_denied'});
 assert(!denied.calls.some(([name])=>name==='crew_leave_requests_admin_page'));
 const resolved=await granted.execute('read_crew_leave',{outlet_name:'Fixture Corner',from:'2026-11-01',to:'2026-11-02'},undefined,{withOutcome:true});
 assert.equal(resolved.requested_scope.outlet_id,id);assert.equal(resolved.total_matching,24);
 await assert.rejects(granted.execute(operation,{...args,outlet_name:'Fixtur Corner'}),{code:'entity_ambiguous'});
});

test('a scoped question gets the registered schema before the generic runner can be used',async()=>{
 const question='What is the current balance of asset-spoon at Fixture Corner?';
 const {caller}=source();
 const business=createBusinessDispatcher({config,access,caller});
 let requests=0;
 const reply=await generateText({prompt:question,kind:'turn',model:config.model},'fixture-secret',{
  business,transport:async(_,init)=>{
   const body=JSON.parse(init.body);
   if(++requests===1){
    assert.deepEqual(body.tools.map(tool=>tool.name),['read_asset_catalogue']);
    assert.deepEqual(body.tool_choice,{type:'function',name:'read_asset_catalogue'});
    return response([functionCall('read_asset_catalogue',{
     page:1,outlet_id:null,outlet_name:'Fixture Corner',mode:'summary',query:'asset-spoon',
    },'asset-current')]);
   }
   const result=JSON.parse(body.input.at(-1).output);
   assert.equal(result.capability,'read_asset_catalogue');
   assert.equal(result.requested_scope.mode,'detail');
   assert.equal(result.rows[0].current_quantity,15);
   return response([{type:'message',content:[{type:'output_text',text:'Fixture Corner has 15 Spoon units.'}]}]);
  },
 });
 assert.equal(requests,2);assert.match(reply.reply,/Spoon at Fixture Corner is 15 unit/);
 const disconnected=createBusinessDispatcher({config:{...config,capability_connections:{...config.capability_connections,read_asset_catalogue:false}},access,caller});
 assert(!disconnected.toolsForPrompt(question).some(tool=>tool.name==='read_asset_catalogue'));
});

test('named Text and SDK schema errors return exact correction only after authorization',async()=>{
 const operation='read_asset_catalogue';
 const args={mode:'detail',outlet_name:'Fixture Corner'};
 const src=source();
 const expected=await createBusinessDispatcher({config,access,caller:src.caller}).execute(operation,args,undefined,{correctArguments:true,withOutcome:true});
 assert.equal(expected.operation,operation);
 assert.equal(expected.error,'tool_arguments_invalid');
 assert.equal(expected.no_evidence,true);
 const voice=await dispatch(voiceRequest(operation,args),{get:()=>undefined,access,caller:src.caller,
  rpc:async()=>({config}),reserveRealtime:async()=>{},voiceHistory:async()=>assert.fail('No evidence to save')});
 assert.deepEqual(voice,expected);
 assert.equal(src.calls.length,0);
});

test('Employees discovery promotes the strict typed schema and rejects malformed scope without showing values',async()=>{
 const operation='read_employee_directory';
 const src=source();
 const business=createBusinessDispatcher({config,access,caller:src.caller});
 const question='Give separate complete counts by employment status and employment type for my authorized Employees scope.';
 assert(business.toolsForPrompt(question).some(tool=>tool.name===operation));
 let requests=0;
 const result=await generateText({prompt:question,kind:'turn',model:config.model},'fixture-secret',{
  business,transport:async(_,init)=>{
   const body=JSON.parse(init.body);
   if(++requests===1)return response([functionCall('find_business_queries',{search:'HR employees',page:1},'discover')]);
   if(requests===2){
    assert.deepEqual(body.tools.find(tool=>tool.name===operation),queryTool(operations.find(op=>op.id===operation)));
    return response([functionCall(operation,{mode:'summary',outlet_id:'invalid-scope'},'invalid')]);
   }
   const evidence=JSON.parse(body.input.at(-1).output);
   if(requests===3){
    assert.equal(evidence.no_evidence,true);
    assert.deepEqual(evidence.validation,{reason:'unsupported_value',field:'outlet_id'});
    assert(!JSON.stringify(evidence).includes('invalid-scope'));
    return response([functionCall(operation,{mode:'summary',outlet_id:null},'corrected')]);
   }
   assert.equal(evidence.summary.total,6);
   return response([{type:'message',content:[{type:'output_text',text:'There are 6 Employees.'}]}]);
  },
 });
 assert.equal(result.reply,'There are 6 Employees.');
 assert.equal(src.calls.filter(([name])=>name==='employee_directory_query').length,1);
});

test('mixed Employees and Raw Materials questions cannot substitute Finished Goods',async()=>{
 const hr='read_employee_directory',rm='read_factory_raw_catalogue',fg='read_factory_finished_goods';
 const question='What is the total authorized Employees headcount, and which three active Factory raw materials have the highest current stock balances in kg?';
 const src=source(),business=createBusinessDispatcher({config,access,caller:src.caller});
 const excluded=business.excludedForPrompt(question);
 assert.deepEqual([...excluded],[fg]);
 assert.equal(business.excludedForPrompt('Compare finished goods and raw materials').size,0);
 const mismatch=await business.execute('find_business_queries',{search:'finished goods',page:1},undefined,{excluded});
 assert(!mismatch.operations.some(op=>op.operation===fg));
 await assert.rejects(business.execute('run_business_query',envelope(fg,{}),undefined,{excluded}),{code:'tool_not_allowed'});
 const committed=[];
 let requests=0;
 await generateText({prompt:question,kind:'turn',model:config.model},'fixture-secret',{
  business,onTool:(state,evidence)=>{if(state==='completed')committed.push(evidence);},
  transport:async(_,init)=>{
   const body=JSON.parse(init.body);
   assert.equal(body.tools.some(tool=>tool.name===fg),false);
   if(++requests===1){
    assert(body.tools.some(tool=>tool.name===hr));assert(body.tools.some(tool=>tool.name===rm));
    return response([functionCall(hr,{mode:'summary',status:'active'},'hr')]);
   }
   if(requests===2)return response([functionCall(rm,{mode:'list',status:'active',sort:'balance_desc',uom:'kg'},'raw')]);
   return response([{type:'message',content:[{type:'output_text',text:'6 employees; RM-25 has 25 kg of raw material.'}]}]);
  },
 });
 assert.deepEqual(committed.map(item=>item.capability),[hr,rm]);
 assert.equal(committed[0].requested_scope.status,'all');
 assert.equal(committed[1].requested_scope.status,'active');
 assert.equal(committed[1].rows[0].material_code,'RM-25');
 assert(!src.calls.some(([table])=>table==='factory_finished_goods'));
 const explicitlyActive=await business.execute(hr,{mode:'summary',status:'active'},undefined,{prompt:'What is the total active employee headcount?'});
 assert.equal(explicitlyActive.requested_scope.status,'active');
});

test('OpenAI Voice can discover newly authorized operations with a narrow starting snapshot',async()=>{
 const initial={...config,capability_connections:{}};
 const voice=await dispatch({action:'realtime_sdk_connect',provider:'openai',session_id:id,request_id:id,
  voice:'cedar',connection_protocol:'server_webrtc_v1'},{
  rpc:async action=>action==='status'?{config:initial}:{},get:k=>({
   NATIVE_ASSISTANT_REALTIME_APPROVED_USE:'native-assistant-staging-realtime-evaluation',
   NATIVE_ASSISTANT_REALTIME_APPROVAL_REFERENCE:'fixture',NATIVE_ASSISTANT_REALTIME_API_KEY:'fixture',
  })[k],reserveRealtime:async()=>({state:'reserved'}),
  issueVoiceTicket:async(_,snapshot)=>{assert.equal(snapshot.tools.length,2);return {client_secret:'local-fixture'};},access,
 });
 assert.deepEqual(voice.tools.map(tool=>tool.name),['find_business_queries','run_business_query']);
 const next=await dispatch(voiceRequest('find_business_queries',{search:'employees',page:1}),
  {rpc:async()=>({config}),get:()=>undefined,reserveRealtime:async()=>{},access});
 assert(next.operations.some(o=>o.operation==='read_employee_directory'));
});

test('wide discovery does not consume result budget or break the current question and call pairing',async()=>{
 const fields=Object.fromEntries(Array.from({length:40},(_,i)=>['filter_'+i,{type:'string',description:'A fixed documented field for this operation.'}]));
 const makeOperations=prefix=>Array.from({length:2},(_,i)=>({operation:prefix+i,module:'fixture',
  parameters:{type:'object',properties:fields,required:Object.keys(fields)}}));
 const business={tools:[{type:'function',name:'find_business_queries'},{type:'function',name:'run_business_query'}],
  execute:async(name,args)=>name==='find_business_queries'
   ?{discovery_only:true,not_business_evidence:true,operations:makeOperations(args.search)}
   :{capability:args.operation,rows:[{description:'r'.repeat(6300)}]}};
 const history=[{prompt:'older request',reply:'x'.repeat(4700)}];
 const query='Compare two authorized results for the same period';
 let n=0;
 const recorded=[];
 const request=await generateText({prompt:query,kind:'turn',model:config.model,assembled:{recent:history}},'fixture-secret',{
  business,onTool:(state,evidence)=>{if(state==='completed')recorded.push(evidence);},
  transport:async(_,init)=>{
   assert(Buffer.byteLength(init.body)<=24000);
   const body=JSON.parse(init.body);
   assert(body.input.some(m=>m.content===query));
   for(const output of body.input.filter(m=>m.type==='function_call_output'))
    assert(body.input.some(m=>m.type==='function_call'&&m.call_id===output.call_id));
   if(n<4){
    const search=n<2?'one':'two';
    const event=n%2===0?functionCall('find_business_queries',{search,page:1},'d'+n)
     :functionCall('run_business_query',envelope(search+'0',{}),'q'+n);
    n++;
    return response([event]);
   }
   return response([{type:'message',content:[{type:'output_text',text:'Two authorized results.'}]}]);
  },
 });
 assert.equal(request.reply,'Two authorized results.');
 assert.equal(recorded.length,2);
});

// Optional replay consumes an aggregate/redacted source export made by an
// authorized reviewer. No remote credentials, provider or writes are involved.
const replayPath=process.env.FEEDX_ASSISTANT_SOURCE_REPLAY;
if(replayPath){
 const snapshot=JSON.parse(readFileSync(replayPath,'utf8'));
 for(const {operation,question,args,expected} of snapshot.cases)test(`Staging source replay: ${operation}`,async()=>{
  const {caller}=source({snapshot});
  const evidence=[];
  let calls=0;
  const r=await dispatch({action:'respond',session_id:id,turn_id:id},{
   access,caller,get:k=>({
    NATIVE_ASSISTANT_OPENAI_API_KEY:'synthetic-key',NATIVE_ASSISTANT_APPROVED_USE:'native-assistant-phase1a',
    NATIVE_ASSISTANT_APPROVAL_REFERENCE:'fixture',NATIVE_ASSISTANT_MODELS:config.model,
   })[k],
   rpc:async(action,payload)=>{
    if(action==='status')return {config:{...config,last_test_outcome:'verified',tested_provider_revision:1,provider_revision:1}};
    if(action==='claim')return {state:'running',lease_id:id,kind:'turn',model:config.model,prompt:question};
    if(action==='tool_record'&&payload.evidence)evidence.push(payload.evidence);
    if(action==='finish')return payload;
    return {};
   },
   transport:async(_,init)=>{
    const body=JSON.parse(init.body);
    if(++calls===1)return response([functionCall('find_business_queries',{search:operation,page:1},'schema')]);
    if(calls===2)return response([functionCall('run_business_query',envelope(operation,args),'read')]);
    const actual=JSON.parse(body.input.at(-1).output);
    for(const [path,value] of Object.entries(expected)){
     const actualValue=path.split('.').reduce((obj,key)=>obj?.[key],actual);
     assert.deepEqual(actualValue,value,path);
    }
    return response([{type:'message',content:[{type:'output_text',text:'Deterministic fixture answer.'}]}]);
   },
  });
  assert.equal(calls,3);
  assert.equal(r.reply,'Deterministic fixture answer.');
  assert.equal(evidence.length,1);
  assert.equal(evidence[0].capability,operation);
 });
}
