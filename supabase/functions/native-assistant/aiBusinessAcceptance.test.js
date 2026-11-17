import test from 'node:test';
import assert from 'node:assert/strict';
import {operations,createBusinessDispatcher} from './business.js';
import {dispatch} from './handler.js';
import {generateText} from './provider.js';
import {createSdkVoiceHistory} from '../../../src/features/ai-assistant/sdkVoiceHistory.js';
import {rawMaterialStockStatus} from '../_shared/factory/stockCatalogue.js';

const reads=operations.filter(o=>o.kind==='READ');
const id='10000000-0000-4000-8000-000000000001';
const config={revision:1,enabled:true,model:'gpt-4o-mini',credential_ref:'native-assistant-openai',
 capability_connections:Object.fromEntries(reads.map(o=>[o.id,true]))};
const access={factory:true,permissions:Object.fromEntries(reads.map(o=>[o.permission,true]))};
const envelope=(operation,args)=>({operation,arguments_json:JSON.stringify(args)});
const voiceRequest=(operation,args)=>({action:'realtime_tool',provider:'openai',session_id:id,
 request_id:id,turn_id:id,operation,arguments:args});
function argsFor(op){
 return Object.fromEntries(Object.entries(op.tool.parameters.properties).map(([key,schema])=>{
  const value=schema.type.includes('null')?null:schema.enum?schema.enum[0]:
   ['integer','number'].includes(schema.type)?schema.minimum??1:
    key.includes('id')?id:key==='to'?'2026-11-02':key==='query'?'':'2026-11-01';
  return [key,value];
 }));
}

for(const op of reads)test(`${op.id}: discovery, argument fencing, AI policy and human denial`,async()=>{
 const business=createBusinessDispatcher({config,access});
 const discovered=await business.execute('find_business_queries',{search:op.id,page:1});
 const exposed=discovered.operations.find(row=>row.operation===op.id);
 assert.deepEqual(exposed?.parameters,op.tool.parameters);
 assert.equal(exposed?.module,op.module_id);
 assert.equal(discovered.not_business_evidence,true);
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
const fixtures={
 employee_directory_query:employee,reporting_monthly_scope_financials:finance,
 crew_leave_requests_admin_page:leave,marketing_planner_read:plan,
};
const stock=Array.from({length:26},(_,i)=>({id:`item-${i}`,product_code:`FG-${i}`,material_code:`RM-${i}`,
 product_name:`Product ${i}`,name:`Material ${i}`,status:'active',uom:'kg',current_balance:i,
 min_stock_level:5,manual_unit_cost:'DO_NOT_EXPOSE'})).concat({id:'mixed',uom:'ml',current_balance:999,status:'active'});

function source({scope=true,brand=true}={}){
 const calls=[];
 const caller={
  rpc(name,args){
   calls.push([name,args]);
   let result={data:fixtures[name]};
   if(name==='current_user_role_id')result={data:'owner'};
   if(name==='current_user_has_permission')result={data:true};
   if(name==='current_user_can_access_outlet')result={data:scope};
   if(name==='factory_get_master_id_snapshot')result={data:stock.map(r=>r.id)};
   if((name==='marketing_planner_read'&&!brand)||(name==='crew_leave_requests_admin_page'&&!scope))result={error:{code:'42501'}};
   return {...result,abortSignal:async()=>result};
  },
  from(table){
   calls.push([table]);
   let included;
   const builder=new Proxy({}, {get:(_,method)=>method==='abortSignal'
    ?async()=>({data:table==='sales_records'?sales:stock.filter(row=>included.includes(row.id))})
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
 ['read_crew_leave','How many leave requests overlapped these dates?',{outlet_id:id,from:'2026-11-01',to:'2026-11-02'},r=>{assert.equal(r.total_matching,24);assert.equal(r.rows.length,1);}],
 ['read_sales_records','Show monthly sales input for this outlet',{outlet_id:id,month:'2026-11-01',page:1},r=>{assert.equal(r.rows[0].amount,125);assert.equal(r.completeness.aggregate_scope,'not_asserted');}],
 ['read_operational_financials','What finance figures exist for this reporting period?',{outlet_id:id,year:2026,month:11},r=>assert.deepEqual(r.report,finance)],
 ['read_marketing_plan','How many tasks are in this Brand planning month?',{organization_id:id,brand_id:id,month:'2026-11-01'},r=>assert.equal(r.total_matching,1)],
];
const response=output=>Response.json({status:'completed',output,usage:{input_tokens:100,output_tokens:10}});
const functionCall=(name,args,call_id)=>({type:'function_call',name,call_id,arguments:JSON.stringify(args)});
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
   if(++n===1)return response([functionCall('find_business_queries',{search:operation,page:1},'discover')]);
   if(n===2)return response([functionCall('run_business_query',envelope(operation,args),'query')]);
   const value=JSON.parse(body.input.at(-1).output);
   check(value);
   assert.equal(value.capability,operation);
   assert.doesNotMatch(JSON.stringify(value),/DO_NOT_EXPOSE/);
   return response([{type:'message',content:[{type:'output_text',text:'The authorized result is attached.'}]}]);
  },
 });
 assert.equal(reply.reply,'The authorized result is attached.');
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
  ['员工','read_employee_directory'],['HR employees','read_employee_directory'],['Restaurant sales input','read_sales_records'],['marketing plan','read_marketing_plan']]){
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
