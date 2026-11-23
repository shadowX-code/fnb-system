import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {operations,createBusinessDispatcher,queryTool} from './business.js';
import {dispatch} from './handler.js';
import {generateText} from './provider.js';
import {assembleContext} from './conversationContext.js';
import {createSdkVoiceHistory} from '../../../src/features/ai-assistant/sdkVoiceHistory.js';
import {rawMaterialStockStatus} from '../_shared/factory/stockCatalogue.js';
import {failureOutcome,outcomeFor,outletContinuation} from './businessQuery.js';
import {malaysiaPeriod} from '../_shared/restaurant/assistantBusinessPeriod.js';
import {generateSourceCases,certifyScenario} from '../../../qa/staging/nativeAssistantCertification.mjs';

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
 if(op.id==='read_operating_expenses')args.year=2026;
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
 assert.deepEqual(invalid.validation,{reason:'unexpected_field'});
 assert(!JSON.stringify(invalid).includes('select *'));
});

// Representative fixed source results. The scripted provider exercises the
// real shared orchestration; human-identifiable Staging rows do not live in Git.
const employee={summary:{total:6,active:4,inactive:2,resigned:2,terminated:0,other:0},
 employment_types:{full_time:2,part_time:1,probation:2,contract:1},rows:[],total_count:6,
 page:1,page_size:20,aggregate_complete:true,schema_version:2,as_of:'fixture'};
const finance={outlet:{id,scope:'outlet',outlet_count:1},period:{year:2026,month:11},financial_completeness:'incomplete',
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
   if(name==='reporting_monthly_scope_financials'&&!snapshot?.rpcs)result={data:{
    ...finance,period:{year:args.p_year,month:args.p_month},
    outlet:{id:args.p_outlet_id,scope:args.p_outlet_id?'outlet':'all',outlet_count:1},
   }};
   if(name==='current_user_role_id')result={data:'owner'};
   if(name==='current_user_has_permission')result={data:true};
   if(name==='current_user_can_access_outlet')result={data:scope};
   if(name==='factory_get_master_id_snapshot'){
    const table=args.p_entity==='finished_goods'?'factory_finished_goods':
     args.p_entity==='product_families'?'factory_product_families':args.p_entity==='finished_good_categories'?'factory_finished_good_categories':'factory_raw_materials';
    result={data:(snapshot?.tables[table]||stock).map(r=>r.id)};
   }
   if((name==='marketing_planner_read'&&!brand)||(name==='crew_leave_requests_admin_page'&&!scope))result={error:{code:'42501'}};
   return {...result,abortSignal:async()=>result};
  },
  from(table){
   calls.push([table]);
   if(['outlets','asset_items','asset_movement_logs','operating_expenses','inventory_items','inventory_movements','departments','job_positions','sales_records','factory_product_recipes'].includes(table)){
    let rows=table==='outlets'?outletRows:table==='asset_items'?assetRows:table==='inventory_items'?inventoryRows:snapshot?.tables[table]||(table==='sales_records'?sales:[]);
    let head=false,count;
    const builder={
     select(fields,options){head=options?.head;return this;},
     in(field,values){rows=rows.filter(row=>field==='inventory_item_outlets.outlet_id'?row.outlets.some(outlet=>values.includes(outlet)):values.includes(row[field]));return this;},
     eq(field,value){rows=rows.filter(row=>row[field]===value);return this;},
     neq(field,value){rows=rows.filter(row=>row[field]!==value);return this;},
     gte(field,value){rows=rows.filter(row=>row[field]>=value);return this;},
     lte(field,value){rows=rows.filter(row=>row[field]<=value);return this;},
     lt(field,value){rows=rows.filter(row=>row[field]<value);return this;},
     ilike(field,pattern){rows=rows.filter(row=>row[field]?.toLowerCase()===pattern.replace(/\\([%_\\])/g,'$1').toLowerCase());return this;},
     limit(max){rows=rows.slice(0,max);return this;},
     order(){return this;},
     range(start,end){count=rows.length;rows=rows.slice(start,end+1);return this;},
     abortSignal:async()=>table==='inventory_items'&&inventoryError?{error:{code:'57014'}}:{data:head?null:rows,count:count??rows.length},
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
 ['read_sales_records','Show monthly sales input for this outlet',{outlet_id:id,month:'2026-11-01',page:1},r=>{
  assert.equal(r.rows[0].amount,125);assert.equal(r.rows[0].outlet_id,id);assert.equal(r.rows[0].month,11);assert.equal(r.total_matching,1);
  assert.equal(r.completeness.aggregate_scope,'complete_filtered_scope');assert.equal(r.rows[0].remark,undefined);
 }],
 ['read_operational_financials','What finance figures exist for this reporting period?',{outlet_id:id,year:2026,month:11},r=>assert.deepEqual(r.report,finance)],
 ['read_marketing_plan','How many tasks are in this Brand planning month?',{organization_id:id,brand_id:id,month:'2026-11-01'},r=>assert.equal(r.total_matching,1)],
];
const response=output=>Response.json({status:'completed',output,usage:{input_tokens:100,output_tokens:10}});
const functionCall=(name,args,call_id)=>({type:'function_call',name,call_id,arguments:JSON.stringify(args)});

test('source-derived business questions use the correct enabled operation through Assistant Text',async()=>{
 const dateRange={from:'2026-01-01',to:'2026-01-31'};
 const samples={
  movements:[{outlet:'Fixture Corner',count:1,filters:{outlet_id:id,movement_type:'Purchase',...dateRange}}],
  departments:[{count:2,filters:{status:'active'}}],
  positions:[{count:1,filters:{department:'Operations',status:'all'}}],
  leave:[{outlet:'Fixture Corner',count:24,filters:{outlet_id:id,...dateRange,status:'approved'}}],
  finishedGoods:[{count:27,filters:{status:'active'}}],
  plans:[{brand:'Fixture Brand',count:1,filters:{month:'2026-11-01',status:'completed',organization_id:id,brand_id:id}}],
 };
 const src=source({snapshot:{rpcs:fixtures,tables:{
  inventory_movements:[
   {id:'movement',outlet_id:id,movement_type:'Purchase',created_at:'2026-01-31T23:59:59.000Z',created_by:'DO_NOT_EXPOSE'},
   {id:'next-month',outlet_id:id,movement_type:'Purchase',created_at:'2026-02-01T00:00:00.000Z'},
   {id:'other-outlet',outlet_id:otherId,movement_type:'Purchase',created_at:'2026-01-17T12:00:00.000Z'},
  ],
  departments:[{id:'a',status:'active'},{id:'b',status:'active'},{id:'c',status:'inactive'}],
  job_positions:[{id:'a',department:'Operations'},{id:'b',department:'Management'}],
  factory_finished_goods:[...stock,{id:'archived',status:'archived'}],
 }}});
 const operationFor={
  movement_filtered_count:'read_inventory_movements',department_count:'read_departments',position_department_count:'read_job_positions',
  crew_status_count:'read_crew_leave',fg_filtered_count:'read_factory_finished_goods',planner_status_count:'read_marketing_plan',
 };
 for(const item of generateSourceCases(samples)){
  const operation=operationFor[item.id];
  const business=createBusinessDispatcher({config,access,caller:src.caller});
  const found=await business.execute('find_business_queries',{search:item.question,page:1});
  assert(found.operations.some(op=>op.operation===operation),item.question);
  let step=0,evidence;
  const args={...item.source.filters};
  if(['movement_filtered_count','department_count','position_department_count','fg_filtered_count'].includes(item.id))args.mode='summary';
  const {reply}=await generateText({kind:'turn',model:config.model,prompt:item.question},'fixture-secret',{
   business,onTool:(state,result)=>{if(state==='completed')evidence=result;},
   transport:async(_,init)=>{
    const body=JSON.parse(init.body);
    step++;
    if(step===1&&body.tools.some(tool=>tool.name===operation))
     return response([functionCall(operation,args,'read')]);
    if(step===1)return response([functionCall('find_business_queries',{search:item.question,page:1},'discover')]);
    if(step===2&&body.input.at(-1).type==='function_call_output'&&JSON.parse(body.input.at(-1).output).discovery_only)
     return response([functionCall('run_business_query',envelope(operation,args),'read')]);
    assert.doesNotMatch(body.input.at(-1).output,/DO_NOT_EXPOSE/);
    const result=JSON.parse(body.input.at(-1).output);
    assert.equal(result.total_matching,item.source.count,item.question);
    return response([{type:'message',content:[{type:'output_text',text:'There are '+result.total_matching+' matching records.'}]}]);
   },
  });
  const certified=certifyScenario(item.id,{source:item.source,turn:{reply,evidence,request_id:id,created_at:'2026-11-22',
   model:config.model,state:'completed',tool_state:'completed'}});
  assert.equal(certified.status,'PASS',JSON.stringify(certified));
 }
 assert(src.calls.some(([rpc,args])=>rpc==='crew_leave_requests_admin_page'&&args.p_filters.status==='approved'));
 await assert.rejects(createBusinessDispatcher({config,access,caller:src.caller}).execute('read_inventory_movements',{
  outlet_id:id,...dateRange,to:'2026-02-30',
 }),{code:'tool_arguments_invalid'});
});

test('monthly Finance comparison preserves missing values and rejects changed outlet scope',async()=>{
 const report=(p,value,outletId)=>({period:{year:p.p_year,month:p.p_month},outlet:{id:outletId,scope:'outlet',outlet_count:1},
  financials:{revenue:{amount:value,presence:value===null?'missing':'present'}}});
 let changed=false;
 const caller={rpc(name,p){
  return {abortSignal:async()=>({data:name==='reporting_monthly_scope_financials'
   ?report(p,p.p_month===1?125:null,changed&&p.p_month===2?otherId:id):true})};
 }};
 const business=createBusinessDispatcher({config,access,caller});
 const args={outlet_id:id,year:2026,month:1,compare_year:2026,compare_month:2};
 const result=await business.execute('read_operational_financials',args,undefined,{withOutcome:true});
 assert.equal(result.report.financials.revenue.amount,125);
 assert.deepEqual(result.comparison_report.financials.revenue,{amount:null,presence:'missing'});
 assert.equal(result.query_outcome,'SUCCESS');
 changed=true;
 await assert.rejects(business.execute('read_operational_financials',args),{code:'business_read_unavailable'});
 await assert.rejects(business.execute('read_operational_financials',{...args,outlet_id:null}),{code:'tool_arguments_invalid'});
 await assert.rejects(business.execute('read_operational_financials',{...args,compare_month:null}),{code:'tool_arguments_invalid'});
});

test('Finished Goods summary distinguishes configured groups from packaging SKUs',async()=>{
 const families=[{id:'family'},{id:'empty-family'}];
 const skus=[
  {id:'first',product_family_id:'family',status:'active'},
  {id:'second',product_family_id:'family',status:'active'},
  {id:'third',product_family_id:'family',status:'inactive'},
  {id:'standalone',product_family_id:null,status:'active'},
 ];
 const {caller}=source({snapshot:{rpcs:fixtures,tables:{factory_finished_goods:skus,factory_product_families:families}}});
 const business=createBusinessDispatcher({config,access,caller});
 const op='read_factory_finished_goods';
 const grouped=await business.execute(op,{mode:'summary',measure:'product'},undefined,{withOutcome:true});
 assert.equal(grouped.measure,'product');
 assert.equal(grouped.total_matching,3);
 assert.equal(grouped.query_outcome,'SUCCESS');
 assert.equal((await business.execute(op,{mode:'summary'})).total_matching,4);
 assert.equal((await business.execute(op,{mode:'summary',status:'active'})).total_matching,3);
 assert.equal((await business.execute(op,{mode:'summary',measure:'product',status:'active'})).total_matching,3);
});

test('model-assisted grouped product count corrects a schema-shaped filter error before reading',async()=>{
 const operation='read_factory_finished_goods';
 const prompt='How many products are in the Factory Finished Goods grouped catalogue?';
 const valid={measure:'product',mode:'summary',page:1,sku:null,query:'',availability:'all',status:'all',sort:'name',uom:null,category_name:null,tag_name:null};
 const families=Array.from({length:6},(_,i)=>({id:'family-'+i}));
 const skus=Array.from({length:26},(_,i)=>({id:'sku-'+i,product_family_id:i<7?families[i%6].id:null}));
 const {caller,calls}=source({snapshot:{rpcs:fixtures,tables:{
  factory_finished_goods:skus,factory_product_families:families,
 }}});
 const recorded=[];
 let step=0;
 const result=await dispatch({action:'respond',session_id:id,turn_id:id},{
  access,caller,get:k=>({
   NATIVE_ASSISTANT_OPENAI_API_KEY:'synthetic-key',NATIVE_ASSISTANT_APPROVED_USE:'native-assistant-phase1a',
   NATIVE_ASSISTANT_APPROVAL_REFERENCE:'fixture',NATIVE_ASSISTANT_MODELS:config.model,
  })[k],
  rpc:async(action,payload)=>{
   if(action==='status')return {config};
   if(action==='claim')return {state:'running',lease_id:id,kind:'turn',model:config.model,prompt};
   if(action==='tool_record'&&payload.evidence)recorded.push(payload.evidence);
   if(action==='finish')return payload;
   return {};
  },
  transport:async(_,init)=>{
   const body=JSON.parse(init.body);
   if(++step===1){
    const tool=body.tools.find(t=>t.name===operation);
    assert(tool.description.includes(JSON.stringify(valid)));
    return response([functionCall(operation,{...valid,query:'PRIVATE_FILTER',status:'active',uom:'kg'},'invalid')]);
   }
   const value=JSON.parse(body.input.at(-1).output);
   if(step===2){
    assert.deepEqual(value.validation,{reason:'required_values',fields:['uom'],expected:{uom:null}});
    assert(!JSON.stringify(value).includes('PRIVATE_FILTER'));
    assert.equal(value.no_evidence,true);
    assert.equal(calls.length,0);
    assert.equal(recorded.length,0);
    return response([functionCall(operation,{...valid,...value.validation.expected},'corrected')]);
   }
   assert.equal(value.total_matching,25);
   assert.equal(value.aggregate_complete,true);
   assert.equal(value.measure,'product');
   return response([{type:'message',content:[{type:'output_text',text:'The grouped catalogue contains 25 finished products.'}]}]);
  },
 });
 assert.equal(step,3);
 assert(result.input_tokens>0);
 assert.equal(recorded.length,1);
 assert.deepEqual(certifyScenario('fg_product_count',{turn:{...result,request_id:id,created_at:'fixture',
  model:config.model,state:'completed',tool_state:'completed',evidence:recorded[0]},
  source:{count:25,filters:{measure:'product'}}}).status,'PASS');
 assert.doesNotMatch(result.reply,/required_values|PRIVATE_FILTER/);
});

const groupedFixture=()=>{
 const families=[
  {id:'f1',name_en:'Dark soy',status:'archived',category_id:'sauce'},
  {id:'f2',name_en:'Empty blend',name_cn:'空酱',status:'active',category_id:'sauce'},
  {id:'f3',name_en:'Tea',status:'active',category_id:'drink'},
 ];
 const skus=[
  {id:'s1',product_code:'S01',variant_name:'200g',product_family_id:'f1',status:'active',category_id:'drink',current_balance:0},
  {id:'s2',product_code:'S02',product_family_id:'f1',status:'archived',category_id:'sauce',current_balance:5},
  {id:'s3',product_code:'T01',product_family_id:'f3',status:'active',category_id:'drink',current_balance:5},
  {id:'s4',product_code:'L01',product_name:'Loose sauce',status:'active',category_id:'sauce',current_balance:0},
 ];
 const tags={tags:[{id:'food',name:'Food Service'}],assignments:[
  {product_family_id:'f1',tag_id:'food'},{product_family_id:'f2',tag_id:'food'},
 ]};
 return {rpcs:{factory_get_finished_good_tags:tags},tables:{factory_finished_goods:skus,factory_product_families:families,
  factory_finished_good_categories:[{id:'sauce',name:'Sauce'},{id:'drink',name:'Drink'}]}};
};

test('Admin family/SKU filters use a surviving child, matching empty families and independent standalone products',async()=>{
 const op='read_factory_finished_goods';
 const snapshot=groupedFixture();
 const {caller,calls}=source({snapshot});
 const business=createBusinessDispatcher({config,access,caller});
 const count=async args=>(await business.execute(op,{mode:'summary',measure:'product',...args})).total_matching;
 assert.equal(await count({}),4);
 assert(!calls.some(([rpc,args])=>rpc==='factory_get_finished_good_tags'||args?.p_entity==='finished_good_categories'));
 assert.equal(await count({query:'空酱'}),1,'empty family name');
 assert.equal(await count({query:'200g'}),1,'packaging variant');
 assert.equal(await count({availability:'out_of_stock'}),2);
 assert.equal(await count({query:'not recorded'}),0);
 assert.equal(await count({status:'active',category_name:'Sauce'}),2,'an active child in a different category cannot satisfy both filters');
 assert.equal(await count({status:'active',category_name:'Drink',tag_name:'Food Service'}),1,'archived family has a matching active child');
 const skus=await business.execute(op,{category_name:'SAUCE',tag_name:'food service'});
 assert.deepEqual(skus.rows.map(row=>row.product_code),['S02']);
 assert.equal(skus.category_name,'Sauce');assert.equal(skus.tag_name,'Food Service');
 assert(!['tags','category_id','product_family_id'].some(field=>field in skus.rows[0]));
 await assert.rejects(count({category_name:'Unlisted'}),{code:'entity_unresolved'});
 await assert.rejects(count({tag_name:'Food Servic'}),{code:'entity_ambiguous'});
 snapshot.rpcs.factory_get_finished_good_tags.tags.push({id:'different-tag',name:'Food-Service'});
 await assert.rejects(count({tag_name:'Food Service'}),{code:'entity_ambiguous'});
 snapshot.rpcs.factory_get_finished_good_tags.assignments.push({tag_id:'invalid',product_family_id:'f1'});
 await assert.rejects(count({tag_name:'Food Service'}),{code:'inventory_unavailable'});
 const denied=()=>assert.fail('A denied operation reached its domain or label lookup');
 for(const [policy,grants,reason] of [[config,{},'factory_read_denied'],[{...config,capability_connections:{}},access,'capability_disconnected']]){
  const gated=createBusinessDispatcher({config:policy,access:grants,caller:{rpc:denied,from:denied}});
  await assert.rejects(gated.execute(op,{mode:'summary',measure:'product',tag_name:'Food Service'}),{code:reason});
 }
});

test('a filtered Finished Goods answer is certified against independently captured Admin group identities and scope',async()=>{
 const op='read_factory_finished_goods';
 const scope={measure:'product',mode:'summary',page:1,sku:null,query:'',availability:'all',status:'all',sort:'name',uom:null,
  category_name:'Sauce',tag_name:'Food Service'};
 const sourceCapture={scope,admin_group_count:2,group_keys:['f1','f2'],all_group_pages:true,scope_label:'Factory Finished Goods, category Sauce, tagged Food Service'};
 const actor='qa-fixture';
 const question='How many grouped Factory Finished Goods products are in the Sauce category with the Food Service tag?';
 const business=createBusinessDispatcher({config,access,caller:source({snapshot:groupedFixture()}).caller});
 let evidence,submissions=0;
 const result=await generateText({kind:'turn',model:config.model,prompt:question},'fixture',{
  business,onTool:(state,value)=>{if(state==='completed')evidence=value;},
  transport:async(_,init)=>{
   const body=JSON.parse(init.body);
   if(++submissions===1){
    assert(body.tools.some(tool=>tool.name===op));
    return response([functionCall(op,{...scope,measure:'sku'},'read')]);
   }
   assert.equal(JSON.parse(body.input.at(-1).output).total_matching,2);
   return response([{type:'message',content:[{type:'output_text',text:'There are 99 packaging SKUs.'}]}]);
  },
 });
 assert.equal(submissions,2);
 assert.equal(result.reply,'2 grouped products (Sauce · Food Service).');
 const record={turn:{...result,evidence,request_id:id,created_at:evidence.as_of,model:config.model,actor_ref:actor,state:'completed',tool_state:'completed'},
  source:{...sourceCapture,capture:{environment:'staging',method:'admin_view',module_id:'factory_finished_goods',
   authority:'/factory/warehouse/finished-goods',at:evidence.as_of,actor_ref:actor}}};
 const check=(turn=record.turn,source=record.source)=>certifyScenario('fg_filtered_product_groups',{turn,source});
 assert.equal(check().status,'PASS',JSON.stringify(check()));
 assert.equal(check({...record.turn,reply:'2 packaging SKUs (Sauce · Food Service).'}).status,'FAIL');
 assert.equal(check({...record.turn,reply:'2 grouped products (Sauce).'}).status,'FAIL');
 assert.equal(check(record.turn,{...record.source,group_keys:['f1','f1']}).status,'FAIL');
 assert.equal(check(record.turn,{...record.source,all_group_pages:false}).status,'FAIL');
 assert.equal(check(record.turn,{...record.source,capture:{...record.source.capture,actor_ref:'other'}}).status,'FAIL');
});

test('product-group pages retain family identities, empty families and the matching SKU count on continuation',async()=>{
 const op='read_factory_finished_goods';
 const families=Array.from({length:21},(_,i)=>({id:'family-'+i,name_en:'Family '+String(i).padStart(2,'0'),status:'active'}));
 const skus=[{id:'sku-a',product_family_id:'family-20',product_name:'Box A',product_code:'BX'},{id:'sku-b',product_family_id:'family-20',product_name:'Bag B',product_code:'BG'},
  {id:'loose',product_name:'Unassigned pack',product_code:'U'}];
 const {caller}=source({snapshot:{rpcs:fixtures,tables:{factory_finished_goods:skus,factory_product_families:[...families].reverse()}}});
 const dispatcher=createBusinessDispatcher({caller,config,access});
 const first=await dispatcher.execute(op,{mode:'list',measure:'product'},undefined,{withOutcome:true});
 assert.equal(first.rows.length,20);assert(first.rows.every(row=>row.matching_packaging_skus===0));
 assert.equal(first.truncated,true);
 const prior={tool_state:'completed',state:'completed',evidence:first};
 const plan=await dispatcher.planTurn('next page',async()=>({turns:[prior]}));
 assert.deepEqual(plan.page.args,{...first.requested_scope,page:2});
 const next=await dispatcher.execute(op,plan.page.args,undefined,{withOutcome:true});
 assert.equal(next.total_matching,22);assert.equal(next.truncated,false);
 const reply=dispatcher.format(op,next,'List product groups in Factory');
 const groups=[...families.map((f,i)=>({key:f.id,name:f.name_en,skus:i===20?2:0})),{key:'__sku_loose',name:'Unassigned pack',skus:1}];
 const capture={environment:'staging',method:'admin_view',module_id:'factory_finished_goods',authority:'/factory/warehouse/finished-goods',at:next.as_of,actor_ref:'fixture'};
 const record={source:{capture,groups,all_group_pages:true,scope:next.requested_scope},turn:{request_id:id,created_at:next.as_of,model:'fixture',state:'completed',tool_state:'completed',actor_ref:'fixture',evidence:next,reply}};
 const check=text=>certifyScenario('fg_product_group_page',{...record,turn:{...record.turn,reply:text}});
 assert.equal(check(reply).status,'PASS',JSON.stringify(check(reply)));
 assert.equal(check(reply.replace('2 matching','1 matching')).status,'FAIL');
 assert.equal(check(reply.replace('Unassigned pack','Family 19')).status,'FAIL');
 const spoken=dispatcher.format(op,first,'List product groups',{medium:'voice'});
 assert.match(spoken,/first 3/);assert.doesNotMatch(spoken,/Family 03/);
});

test('other READ field-combination errors identify safe corrections before domain access',async()=>{
 const noSource=()=>assert.fail('Rejected arguments reached a domain source');
 const business=createBusinessDispatcher({config,access,caller:{rpc:noSource,from:noSource}});
 const cases=[
  ['read_factory_raw_catalogue',{mode:'summary',page:2,sort:'balance_desc'},
   {reason:'required_values',fields:['page','sort'],expected:{page:1,sort:'name'}}],
  ['read_inventory_movements',{outlet_id:id,from:'2026-11-01',to:null},
   {reason:'paired_dates_required',field:'to'}],
  ['read_operational_financials',{outlet_id:id,year:2026,month:1,compare_year:2026,compare_month:null},
   {reason:'paired_period_required',field:'compare_month'}],
 ];
 for(const [operation,args,validation] of cases){
  const result=await business.execute('run_business_query',envelope(operation,args));
  assert.equal(result.operation,operation);
  assert.equal(result.no_evidence,true);
  assert.deepEqual(result.validation,validation);
 }
});

test('unrecorded stock units produce correction feedback, while a valid empty filter remains zero',async()=>{
 const fg='read_factory_finished_goods',rm='read_factory_raw_catalogue';
 const {caller}=source();
 const business=createBusinessDispatcher({config,access,caller});
 for(const operation of [fg,rm]){
  const error=await business.execute(operation,{mode:'summary',uom:'sku'},undefined,{correctArguments:true});
  assert.deepEqual(error.validation,{reason:'stock_unit_not_recorded',field:'uom'});
  assert.equal(error.no_evidence,true);
  assert.equal((await business.execute(operation,{mode:'summary',status:'archived',uom:'kg'})).total_matching,0);
 }
 const prompt='How many active Factory Finished Goods packaging SKUs are registered?';
 const args={mode:'summary',status:'active',uom:null,measure:'sku'};
 let step=0;
 const saved=[];
 const result=await generateText({kind:'turn',model:config.model,prompt},'fixture',{
  business,onTool:(_state,evidence)=>{if(evidence)saved.push(evidence);},
  transport:async(_,init)=>{
   const body=JSON.parse(init.body);
   if(++step===1)return response([functionCall(fg,{...args,uom:'sku'},'bad-unit')]);
   const output=JSON.parse(body.input.at(-1).output);
   if(step===2){
    assert.equal(output.validation.field,'uom');
    assert.equal(saved.length,0);
    return response([functionCall(fg,args,'all-units')]);
   }
   assert.equal(output.total_matching,27);
   return response([{type:'message',content:[{type:'output_text',text:'27 active packaging SKUs.'}]}]);
  },
 });
 assert.equal(result.reply,'27 active packaging SKUs.');
 assert.equal(saved.length,1);
 assert.equal(saved[0].uom,null);
});

test('model-selected Factory SKU pages finish from complete saved evidence without another provider response',async()=>{
 const operation='read_factory_finished_goods';
 const rows=Array.from({length:26},(_,i)=>{
  const code='SKU-'+String(i+1).padStart(2,'0');
  return {id:code,product_code:code,product_name:code,current_balance:i,uom:'kg',status:i===25?'inactive':'active'};
 });
 const {caller}=source({snapshot:{rpcs:fixtures,tables:{factory_finished_goods:rows}}});
 const business=createBusinessDispatcher({config,access,caller});
 const turns=[];
 const history=async()=>({turns});
 const prompts=[
  'List page 1 of all Factory Finished Goods packaging SKUs, including inactive SKUs, with SKU and current balance. State the complete catalogue total.',
  'Show page 2 of all those products with SKU and current balance. State how many products are on this page versus the complete total.',
 ];
 for(const [index,prompt] of prompts.entries()){
  const page=index+1;
  let evidence;
  let calls=0;
  const output=await generateText({kind:'turn',model:config.model,prompt},'fixture',{
   business,history,onTool:(state,result)=>{if(state==='completed')evidence=result;},
   transport:async()=>{
    assert.equal(++calls,1,'A page read must finish before post-tool synthesis can fail');
    return response([functionCall(operation,{mode:'list',page:1,status:'active'},'page-'+page)]);
   },
  });
  const expected=rows.slice(index*20,page*20);
  assert.equal(evidence.total_matching,26);
  assert.deepEqual(evidence.rows.map(row=>row.product_code),expected.map(row=>row.product_code));
  assert.match(output.reply,new RegExp('Page '+page+': '+expected.length+' packaging SKUs\\. Catalogue total: 26 packaging SKUs\\.'));
  assert(output.input_tokens>0);
  turns.push({...output,prompt,evidence,state:'completed',tool_state:'completed',request_id:id,created_at:'fixture',model:config.model});
 }
 const scope={total:26,returned:6,rows:rows.slice(20).map(row=>[row.product_code,row.current_balance,row.uom])};
 const followUp=turns[1];
 assert.equal(certifyScenario('fg_page',{turn:followUp,source:scope}).status,'PASS');
 const mismatched=async()=>({turns:[{...turns[0],evidence:{...turns[0].evidence,status:'active'}}]});
 assert.equal((await business.planTurn(prompts[1],mismatched,undefined,{textPages:true}))?.textPage,undefined);
 assert.equal((await business.planTurn(prompts[0]+' Also explain the cost.',history,undefined,{textPages:true}))?.textPage,undefined);
 assert.equal((await business.planTurn('Show page 2 of Raw Materials with SKU and current balance.',history,undefined,{textPages:true}))?.textPage,undefined);
 assert.equal((await business.planTurn(prompts[0],history))?.textPage,undefined);
});

test('Malay single-asset replies preserve source units and use the request language',async()=>{
 const operation='read_asset_catalogue';
 const business=createBusinessDispatcher({config,access,caller:source().caller});
 const prompt='Berapa baki aset Spoon di Fixture Corner sekarang?';
 const result=await business.execute(operation,{mode:'detail',outlet_id:id,query:'Spoon'});
 assert.equal(business.format(operation,result,prompt),'Baki aset Spoon di Fixture Corner ialah 15 unit.');
});

test('each clause offers its authorized READ for a mixed Employees and Finished Goods query',async()=>{
 const hr='read_employee_directory',fg='read_factory_finished_goods';
 const question='How many authorized Employees are there, and what is the current Factory Finished Goods stock for SKU S01?';
 const {caller}=source({snapshot:{rpcs:fixtures,tables:{factory_finished_goods:[{
  id:'fixture-sku',product_code:'S01',product_name:'Fixture SKU',current_balance:62,uom:'kg',status:'active',
 }]}}});
 const business=createBusinessDispatcher({config,access,caller});
 assert.deepEqual(business.toolsForPrompt(question).map(tool=>tool.name),[hr,fg]);
 const saved=[];
 let step=0;
 const result=await generateText({kind:'turn',model:config.model,prompt:question},'fixture',{
  business,onTool:(_state,evidence)=>{if(evidence)saved.push(evidence);},
  transport:async(_,init)=>{
   const body=JSON.parse(init.body);
   assert(body.tools.some(t=>t.name===hr));
   assert(body.tools.some(t=>t.name===fg));
   if(++step===1)return response([functionCall(fg,{mode:'detail',sku:'S01'},'sku')]);
   if(step===2)return response([functionCall(hr,{mode:'summary',status:'active'},'headcount')]);
   assert.equal(JSON.parse(body.input.at(-1).output).requested_scope.status,'all');
   return response([{type:'message',content:[{type:'output_text',text:'6 employees and 62 kg for SKU S01.'}]}]);
  },
 });
 assert.equal(step,3);
 assert.equal(result.reply,'6 employees and 62 kg for SKU S01.');
 assert.deepEqual(saved.map(e=>e.capability),[fg,hr]);
 assert.equal(saved[0].rows[0].current_balance,62);
 assert.equal(saved[1].summary.total,6);
 const summary={mode:'summary',status:'active'};
 for(const prompt of ['How many employees are there?','Give me the total employee headcount.',
  'How many employees are there, and how many are active?', // Both values are available only from the unfiltered summary.
  '我可查看的员工总人数是多少？另外，工厂成品 SKU S01 目前的库存余额是多少公斤？',
  '員工總人數是多少？','Berapakah jumlah keseluruhan kakitangan saya?',
  'Berapa jumlah pekerja, dan berapa bahan mentah aktif dalam kilang?',
  'How many employees are there and which raw materials are active?']){
  assert.equal((await business.execute(hr,summary,undefined,{prompt})).requested_scope.status,'all');
 }
 for(const prompt of ['How many active employees are there?','How many employees, active only?',
  '在职员工总人数是多少？','在職員工有多少？','员工总人数？仅限在职。','Berapakah jumlah pekerja aktif?']){
  assert.equal((await business.execute(hr,summary,undefined,{prompt})).requested_scope.status,'active');
 }
});

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
  assert.deepEqual(evidence.requested_scope,{outlet_id:id,year:2026,month:1,compare_year:null,compare_month:null,measure:'financials'});
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

test('complete asset pages preserve scope, include unit balances and never query archived or other-outlet rows',async()=>{
 const operation='read_asset_catalogue';
 const assetRows=Array.from({length:22},(_,i)=>({id:'asset-'+i,outlet_id:id,name:'Asset '+i,
  asset_code:'A'+i,status:'active',current_quantity:i,unit:'unit'})).concat(assets.slice(2));
 const src=source({assetRows});
 const business=createBusinessDispatcher({caller:src.caller,config,access});
 const snapshots=[];
 const history=async()=>({turns:snapshots});
 const run=prompt=>generateText({kind:'turn',model:config.model,prompt},'fixture',{
  business,history,transport:()=>assert.fail('A confirmed catalogue page needs no provider call'),
  onTool(state,evidence){if(evidence)snapshots.push({state:'completed',tool_state:state,evidence});},
 });
 const first=await run('List all assets at Fixture Corner.');
 const second=await run('Next page');
 for(const reply of [first,second])assert.equal(reply.input_tokens,0);
 assert.match(first.reply,/Fixture Corner has 22 current asset records/);
 assert.match(second.reply,/Page 2 of 2/);
 assert.deepEqual(snapshots.map(x=>[x.evidence.page,x.evidence.rows.length,x.evidence.total_matching,x.evidence.outlet.id]),[[1,20,22,id],[2,2,22,id]]);
 assert.deepEqual(snapshots[1].evidence.rows.map(a=>[a.asset_code,a.current_quantity,a.unit]),[['A20',20,'unit'],['A21',21,'unit']]);
 assert.equal((await business.planTurn('Next page at Different Outlet',history))?.page,undefined);
 assert.equal((await business.planTurn('Next page',history))?.page,undefined);
 const denied=createBusinessDispatcher({caller:source({scope:false,assetRows}).caller,config,access});
 await assert.rejects(denied.execute(operation,{mode:'list',outlet_name:'Fixture Corner'}),{code:'business_read_denied'});
});

test('Asset Tracking history and a date-only follow-up share the actual SDK tool dispatch and Text evidence',async()=>{
 const operation='read_asset_catalogue';
 const movements=[
  {id:'a',outlet_id:id,asset_id:'fork',movement_date:'2026-11-22',movement_type:'reduce',quantity_change:-1,quantity_before:75,quantity_after:74,remark:'DO_NOT_EXPOSE'},
  {id:'b',outlet_id:id,asset_id:'fork',movement_date:'2026-05-30',movement_type:'add',quantity_change:75,quantity_before:0,quantity_after:75},
  {id:'c',outlet_id:id,asset_id:'spoon',movement_date:'2026-11-22',quantity_change:99},
  {id:'d',outlet_id:otherId,asset_id:'fork',movement_date:'2026-11-22',quantity_change:99},
 ];
 const {caller}=source({snapshot:{tables:{asset_movement_logs:movements}}});
 const business=createBusinessDispatcher({config,access,caller});
 const prompt='Show the Fork movement history at Fixture Corner.';
 // The transcript owns history-vs-balance selection even if the model sends the old shape.
 const args={mode:'detail',query:'Fork',outlet_name:'Fixture Corner'};
 const original=await business.execute(operation,args,undefined,{prompt,withOutcome:true});
 assert.equal(original.query_outcome,'SUCCESS');assert.equal(original.total_matching,2);
 assert.deepEqual(original.rows.map(row=>row.movement_date),['2026-11-22','2026-05-30']);
 assert.doesNotMatch(JSON.stringify(original),/DO_NOT_EXPOSE/);
 const datePrompt='From 2026-11-01 to 2026-11-30';
 const past={state:'completed',tool_state:'completed',evidence:original};
 const history=async()=>({turns:[past]});
 let textEvidence,voiceEvidence;
 const text=await generateText({kind:'turn',model:config.model,prompt:datePrompt},'fixture',{
  business,history,onTool(_,evidence){if(evidence)textEvidence=evidence;},transport:()=>assert.fail('The dated follow-up needs no model turn'),
 });
 assert.match(text.reply,/Fixture Corner has 1 recorded Fork movement/);
 assert.match(text.reply,/2026-11-22: -1 unit \(75 → 74\)/);
 const voice=await dispatch(voiceRequest(operation,args),{
  caller,access,get:()=>undefined,async rpc(action){
   return action==='history'?{turns:[past,{state:'running',request_id:id,voice_input_available:true,prompt:datePrompt}]}:{config};
  },reserveRealtime:async()=>{},voiceHistory:async fields=>{voiceEvidence=fields.evidence;},
 });
 assert.deepEqual(voiceEvidence.requested_scope,textEvidence.requested_scope);
 assert.deepEqual(voice.rows,textEvidence.rows);
 const next=await business.execute(operation,{...args,mode:'movements',query:'Spoon',from:'2026-04-01',to:'2026-04-30'});
 assert.equal(next.total_matching,0);assert.equal(next.match_status,'matched');
 assert.equal((await business.planTurn(datePrompt,async()=>({turns:[past,{state:'completed',tool_state:'failed'}]})))?.followUp,undefined);
});

test('Operating Expenses uses entered monthly amounts, separates empty periods and never falls back to Finance',async()=>{
 const operation='read_operating_expenses';
 const {caller,calls}=source({snapshot:{tables:{operating_expenses:[
  {id:'1',outlet_id:id,year:2026,month:1,amount:10000,remark:'DO_NOT_EXPOSE'},
  {id:'2',outlet_id:otherId,year:2026,month:2,amount:999},
  {id:'3',outlet_id:id,year:2025,month:1,amount:999},
 ]}}});
 const business=createBusinessDispatcher({config,access,caller});
 const prompt='What are the 2026 operating expenses at Fixture Corner?';
 let evidence;
 const result=await generateText({kind:'turn',model:config.model,prompt},'fixture',{
  business,onTool(_,value){if(value)evidence=value;},transport:()=>assert.fail('A named outlet and single calendar year resolve directly'),
 });
 assert.equal(evidence.period_complete,false);assert.equal(evidence.total_amount,10000);assert.equal(evidence.recorded_months,1);
 assert.equal(evidence.missing_months.length,11);
 assert.match(result.reply,/RM\s*10,000.00.*1 of 12 months/);
 assert(!calls.some(([table])=>table==='reporting_monthly_scope_financials'));
 assert.doesNotMatch(JSON.stringify(evidence),/DO_NOT_EXPOSE/);
 const absent=await business.execute(operation,{month:'2026-02-01',outlet_id:id},undefined,{withOutcome:true});
 assert.equal(absent.total_amount,null);assert.equal(absent.query_outcome,'NO_MATCH');
 const categories='Break down Fixture Corner operating expenses by category in 2026';
 assert.equal(await business.resolvedArguments(await business.planTurn(categories),categories),null);
 await assert.rejects(createBusinessDispatcher({caller,config,access:{}}).execute(operation,{year:2026,outlet_id:id}),{code:'business_read_denied'});
});

test('Restaurant item identity, posted history and verified stock are separate canonical reads',async()=>{
 const items=[{id:'r',outlets:[id],item_name:'Rice',sku_code:'R01',status:'active',unit:'kg'}];
 const movements=[{id:'movement',outlet_id:id,inventory_item_id:'r',movement_type:'Purchase',reference_no:'REF',
  quantity:4,unit:'kg',created_at:'2026-11-22T10:00:00Z'}];
 const {caller}=source({inventoryRows:items,snapshot:{
  rpcs:{inventory_dashboard_stock_evidence:{position_count:1,positions:[{item_id:'r',outlet_id:id,state:'changed',actual_count:6}]}},
  tables:{inventory_movements:movements},
 }});
 const business=createBusinessDispatcher({config,access,caller});
 const detail=await business.execute('read_inventory_items',{mode:'detail',query:'Rice',outlet_id:id});
 assert.equal(detail.rows[0].item_name,'Rice');assert(!Object.hasOwn(detail.rows[0],'confirmed_count'));
 const history=await business.execute('read_inventory_movements',{outlet_id:id,item_query:'Rice',reference:'REF',from:'2026-11-22',to:'2026-11-22'});
 assert.equal(history.rows[0].quantity,4);assert.equal(history.total_matching,1);
 assert.equal(history.rows[0].item_name,'Rice');assert.equal(history.rows[0].sku,'R01');
 const unfiltered=await business.execute('read_inventory_movements',{outlet_id:id});
 assert.equal(unfiltered.rows[0].item_name,'Rice');assert.equal(unfiltered.rows[0].sku,'R01');
 const dashboardSource=source({inventoryRows:[...items,{id:'elsewhere',outlets:[otherId],item_name:'Rice',sku_code:'R02',status:'active',unit:'bags'}],
  snapshot:{rpcs:{inventory_dashboard_stock_evidence:{position_count:1,positions:[{item_id:'r',outlet_id:id,state:'changed',actual_count:6}]}}}});
 const dashboard=createBusinessDispatcher({config,access,caller:dashboardSource.caller});
 const stock=await dashboard.execute('read_inventory_stock_evidence',{outlet_id:id,item_query:'Rice'});
 assert.equal(stock.rows[0].state,'changed');assert.equal(stock.rows[0].confirmed_count,null);
 assert.equal(stock.rows[0].actual_count,6);
 assert.equal(business.plan('What is the physical stock balance at this Restaurant outlet?').operation,'read_inventory_stock_evidence');
 assert.equal(business.plan('List inventory movements at Fixture Corner.').operation,'read_inventory_movements');
});

test('relative period follow-ups use the Malaysian calendar across month and year boundaries',()=>{
 const midnight=new Date('2026-12-31T16:00:00Z');
 assert.deepEqual(malaysiaPeriod('month',midnight),{from:'2027-01-01',to:'2027-01-31',year:2027});
 assert.deepEqual(malaysiaPeriod('previous_month',midnight),{from:'2026-12-01',to:'2026-12-31',year:2026});
 assert.deepEqual(malaysiaPeriod('previous_year',midnight),{from:'2026-01-01',to:'2026-12-31',year:2026});
});

test('an explicit adjacent outlet confirmation scopes Mandarin Operating Expenses across Voice turns',async()=>{
 const operation='read_operating_expenses';
 const year=malaysiaPeriod('year').year;
 const {caller}=source({snapshot:{tables:{operating_expenses:[{id:'1',outlet_id:id,year,month:1,amount:10000}]}}});
 const prompt='是的，是的，我要看它在今年的 operating expenses。';
 const prior=[{state:'completed',tool_state:'completed',evidence:{capability:'read_operating_expenses',
  outlet:{id:otherId},query_domain:'restaurant'}},{state:'completed',prompt:'FC. Fixture Corner.'}];
 const business=createBusinessDispatcher({config,access,caller});
 const history=async()=>({turns:prior});
 let saved;
 const text=await generateText({kind:'turn',model:config.model,prompt},'fixture',{
  business,history,transport:()=>assert.fail('Confirmed outlet and calendar year need no provider call'),
  onTool(_,evidence){if(evidence)saved=evidence;},
 });
 assert.equal(saved.outlet.id,id);
 assert.match(text.reply,/Fixture Corner.*10,000.*1.*11/);
 const voice=await dispatch(voiceRequest(operation,{outlet_id:otherId,year:year-1}),{
  caller,access,get:()=>undefined,rpc:async action=>action==='history'
   ? {turns:[...prior,{state:'running',request_id:id,voice_input_available:true,prompt}]}:{config},
  reserveRealtime:async()=>{},voiceHistory:async()=>{},
 });
 assert.equal(voice.outlet.id,id);assert.equal(voice.requested_scope.year,year);assert.equal(voice.answer_hint,text.reply);
 const namedPrompt='请查 Different Outlet 在今年的 operating expenses。';
 const named=await business.resolvedArguments(await business.planTurn(namedPrompt,history),namedPrompt,history);
 assert.equal(named.outlet_name,'Different Outlet');
 const failedHistory=async()=>({turns:[{state:'completed',tool_state:'failed',prompt:'FC. Fixture Corner.'}]});
 assert.equal(await business.resolvedArguments(await business.planTurn(prompt,failedHistory),prompt,failedHistory),null);
});

test('relative Mandarin movement follow-up stays in Asset Tracking and retains the verified outlet',async()=>{
 const operation='read_asset_catalogue';
 const {caller}=source({snapshot:{tables:{asset_movement_logs:[
  {id:'a',asset_id:'fork',outlet_id:id,movement_date:'2026-11-22',quantity_change:-1,quantity_before:1,quantity_after:0}
 ]}}});
 const business=createBusinessDispatcher({config,access,caller});
 const catalogue=await business.execute(operation,{mode:'list',outlet_id:id},undefined,{withOutcome:true});
 const history=async()=>({turns:[{state:'completed',tool_state:'completed',evidence:catalogue}]});
 const prompt='那你帮我看看 Fork，它进出的记录是怎样的。';
 // A saved transcript can contain a phonetic spelling, so the tool must
 // still resolve its item through the authorized source, not the planner.
 const speech=prompt.replace('Fork','FOK');
 const plan=await business.planTurn(speech,history);
 assert.equal(plan?.operation,operation);assert.equal(plan.contextualOutlet,id);
 const result=await business.execute(operation,{mode:'detail',query:'Fork',outlet_id:otherId},undefined,{prompt:speech,history});
 assert.deepEqual([result.asset.name,result.outlet.id,result.total_matching],['Fork',id,1]);
 const wrong=await business.execute(operation,{mode:'detail',query:'No such asset'},undefined,{prompt:speech,history,withOutcome:true});
 assert.equal(wrong.query_outcome,'NO_MATCH');
 assert.equal((await business.planTurn('那工厂的库存进出记录呢？',history))?.operation,undefined);
});

test('compound business goal retains independent scopes and postpones recommendations until both reads settle',async()=>{
 const expenses='read_operating_expenses',catalogue='read_asset_catalogue';
 const prompt='Give Fixture Corner recorded 2026 operating expenses and Different Outlet current asset count, and recommend one next check for interpreting cost.';
 const {caller}=source({snapshot:{tables:{operating_expenses:[
  {id:'jan',outlet_id:id,year:2026,month:1,amount:125},
  {id:'elsewhere',outlet_id:otherId,year:2026,month:1,amount:999},
 ]}}});
 const business=createBusinessDispatcher({caller,config,access});
 assert.deepEqual(business.planGoal(prompt).map(s=>s.operation),[expenses,catalogue]);
 const saved=[];
 const result=await generateText({kind:'turn',model:config.model,prompt},'fixture-secret',{
  business,onTool:(_,e)=>{if(e)saved.push(e);},transport:async(_,init)=>{
   const body=JSON.parse(init.body);
   if(saved.length===0){
    assert.equal(body.tool_choice,'required');
    return response([functionCall(expenses,{year:2025,outlet_id:otherId},'cost')]);
   }
   if(saved.length===1){
    assert.deepEqual(body.tool_choice,{type:'function',name:catalogue});
    assert.equal(saved[0].total_amount,125);assert.equal(saved[0].recorded_months,1);
    return response([functionCall(catalogue,{mode:'summary',outlet_id:id},'assets')]);
   }
   assert.equal(body.tool_choice,'none');
   assert.equal(saved[1].outlet.id,otherId);assert.equal(saved[1].total_matching,1);
   return response([{type:'message',content:[{type:'output_text',text:
    'Fixture Corner recorded RM125 and Different Outlet has one asset. Look at utility categories to explain this cost.'}]}]);
  },
 });
 assert.match(result.reply,/RM\s*125.*1 of 12 months.*Different Outlet has 1 current asset.*monthly totals only/is);
 assert.doesNotMatch(result.reply,/categories|utility/i);
 assert.deepEqual(saved.map(e=>e.capability),[expenses,catalogue]);
 assert.equal(await business.planTurn('Why did Fixture Corner operating expenses increase this year?'),null);
 // Advice about the observed expense cannot authorize a write.
 await assert.rejects(business.execute('prepare_marketing_draft',{},undefined,{prompt}),{code:'tool_not_allowed'});
 const early=await generateText({kind:'turn',model:config.model,prompt},'fixture-secret',{business,
  transport:async()=>response([{type:'message',content:[{type:'output_text',text:'Both outlets recorded RM9000.'}]}]),
 });
 assert.doesNotMatch(early.reply,/9000/);
 const revoked=createBusinessDispatcher({caller,config,access,loadConfig:async()=>({...config,
  capability_connections:{...config.capability_connections,[catalogue]:false}})});
 let calls=0;
 const partial=await generateText({kind:'turn',model:config.model,prompt},'fixture-secret',{business:revoked,
  transport:async()=>{
   if(++calls===1)return response([functionCall(expenses,{year:2026,outlet_id:id},'cost')]);
   if(calls===2)return response([functionCall(catalogue,{mode:'summary',outlet_id:otherId},'unavailable')]);
   return response([{type:'message',content:[{type:'output_text',text:'Expenses were RM9000 and there were 85 assets.'}]}]);
  },
 });
 assert.match(partial.reply,/RM\s*125\.00/);
 assert.match(partial.reply,/Asset Tracking.*access does not allow/);
 assert.doesNotMatch(partial.reply,/9000|85 assets/);
});

test('SDK continuation uses only current-turn scoped evidence and leaves audio continuation with the SDK',async()=>{
 const expenses='read_operating_expenses',catalogue='read_asset_catalogue';
 const prompt='Give Fixture Corner recorded 2026 operating expenses and show the current asset count at the same outlet, and recommend one next check for interpreting cost.';
 const {caller}=source({snapshot:{tables:{operating_expenses:[{id:'jan',outlet_id:id,year:2026,month:1,amount:125}]}}});
 const saved=[];
 const deps={caller,access,get:()=>undefined,rpc:async action=>action==='history'?
  {turns:[{request_id:otherId,state:'completed',tool_state:'completed',evidence:{capability:catalogue,outlet:{id:otherId}}},
   {request_id:id,voice_input_available:true,prompt}]}:{config},reserveRealtime:async()=>{},
  voiceHistory:async ({evidence})=>{saved.push(evidence);return {evidence:saved.length===1?evidence:{capability:'business_evidence',items:saved}};},
 };
 const first=await dispatch(voiceRequest(expenses,{year:2026,outlet_id:id}),deps);
 assert.deepEqual(first.goal.next_operations,[catalogue]);
 assert.equal(first.answer_hint,undefined);
 const second=await dispatch(voiceRequest(catalogue,{mode:'summary',outlet_id:otherId}),deps);
 assert.deepEqual(second.goal.next_operations,[]);
 assert.deepEqual(second.goal.parts.map(s=>s.outcome),['SUCCESS','SUCCESS']);
 assert.equal(second.outlet.id,id);assert.equal(second.total_matching,2);
 assert.match(second.answer_hint,/RM\s*125.*1 of 12 months.*2 current asset.*monthly totals only/is);
 assert.doesNotMatch(second.answer_hint,/categor|utility/i);
 assert(!saved.some(e=>e.goal||e.answer_hint));
 const unresolved=prompt.replace('Fixture Corner','Unrecognized site');
 const priorScope=async()=>({turns:[{state:'completed',tool_state:'completed',evidence:saved.at(-1)}]});
 await assert.rejects(createBusinessDispatcher({caller,config,access}).execute(catalogue,{mode:'summary',outlet_id:id},undefined,{
  prompt:unresolved,history:priorScope,
 }),{code:'entity_scope_required'});
 const missingTranscript={...deps,rpc:async action=>action==='history'?{turns:[{request_id:id,voice_input_available:false}]}:{config}};
 await assert.rejects(dispatch(voiceRequest('read_employee_directory',{mode:'summary'}),missingTranscript),{code:'entity_scope_required'});
});

test('translation recovery after discovery validates the actual enveloped arguments once per operation',async()=>{
 const op='read_asset_catalogue';
 const {caller}=source();
 const business=createBusinessDispatcher({caller,config,access});
 const saved=[];
 let calls=0;
 const params={mode:'detail',outlet_name:'Fixture Corner',query:'汤匙'};
 const answer=await generateText({kind:'turn',model:config.model,prompt:'Use the catalogue for the item called 汤匙.'},'fixture-secret',{
  business,onTool:(_,e)=>{if(e)saved.push(e);},
  transport:async(_,init)=>{
   const body=JSON.parse(init.body);
   if(++calls===1)return response([functionCall('find_business_queries',{search:'asset tracking',page:1},'find')]);
   if(calls===2)return response([functionCall('run_business_query',envelope(op,params),'original')]);
   if(calls===3){
    const feedback=JSON.parse(body.input.at(-1).output);
    assert.equal(feedback.resolution_required,'cross_language_name');
    assert(!feedback.candidates.some(c=>'current_quantity' in c));
    return response([functionCall('run_business_query',envelope(op,{...params,query:'Spoon'}),'translation')]);
   }
   const e=JSON.parse(body.input.at(-1).output);
   assert.equal(e.outlet.id,id);assert.equal(e.rows[0].name,'Spoon');
   return response([{type:'message',content:[{type:'output_text',text:'Fixture Corner 有 15 把汤匙。'}]}]);
  },
 });
 assert.match(answer.reply,/15/);
 assert.equal(saved.length,1);
 assert.equal(saved[0].rows[0].current_quantity,15);
});

test('repeated scoped SDK reads reuse the current turn while changed arguments still query their owner',async()=>{
 const op='read_asset_catalogue';
 const {caller,calls}=source();
 let turn={request_id:id,voice_input_available:true,prompt:'Can you check the asset records?'};
 const deps={caller,access,get:()=>undefined,rpc:async action=>action==='history'?{turns:[turn]}:{config},
  reserveRealtime:async()=>{},voiceHistory:async({evidence})=>{turn={...turn,evidence};return turn;},
 };
 const args={mode:'detail',query:'Spoon',outlet_name:'Fixture Corner'};
 const first=await dispatch(voiceRequest(op,args),deps);
 const accesses=calls.filter(([name])=>name==='asset_items').length;
 const again=await dispatch(voiceRequest('run_business_query',envelope(op,{outlet_name:'Fixture Corner',query:'Spoon',mode:'detail'})),deps);
 assert.equal(again.already_read,true);assert.equal(again.rows,undefined);
 assert.equal(calls.filter(([name])=>name==='asset_items').length,accesses);
 assert.equal(turn.evidence.rows[0].id,first.rows[0].id);
 const changed=await dispatch(voiceRequest(op,{...args,query:'Fork'}),deps);
 assert.equal(changed.rows[0].name,'Fork');
});

test('a failed named outlet correction cannot silently borrow an older balance on a later follow-up',async()=>{
 const op='read_asset_catalogue';
 const b=createBusinessDispatcher({config,access,caller:source().caller});
 const old=await b.execute(op,{mode:'detail',query:'Spoon',outlet_id:id},undefined,{withOutcome:true});
 const history=async()=>({turns:[{state:'completed',tool_state:'completed',evidence:old},
  {state:'completed',tool_state:'failed',prompt:'Actually use Unknown Corner.'}]});
 await assert.rejects(b.execute(op,{mode:'detail',query:'Spoon',outlet_id:id},undefined,{prompt:'How many spoons at that outlet?',history}),{code:'entity_scope_required'});
 const explicit=await b.execute(op,{mode:'detail',query:'Spoon',outlet_id:otherId},undefined,{prompt:'How many spoons at Fixture Corner?',history});
 assert.equal(explicit.outlet.id,id);
});

test('Text and SDK ask for the actual ranking unit when the Factory source spans incompatible units',async()=>{
 const op='read_factory_raw_catalogue',params={mode:'list',sort:'balance_desc',status:'active'};
 const prompt='Which raw materials have the highest balances?';
 const {caller}=source(),business=createBusinessDispatcher({config,access,caller});
 const saved=[];
 let calls=0;
 const text=await generateText({kind:'turn',model:config.model,prompt},'fixture-secret',{business,
  onTool:(_,e)=>{if(e)saved.push(e);},
  transport:async()=>++calls===1?response([functionCall(op,params,'rank')]):
   response([{type:'message',content:[{type:'output_text',text:'The largest raw material has 999 units.'}]}]),
 });
 assert.match(text.reply,/Which unit should I rank.*kg/i);
 assert.doesNotMatch(text.reply,/999/);
 assert.equal(saved[0].ranking.status,'unit_required');
 const spoken=await dispatch(voiceRequest(op,params),{caller,access,get:()=>undefined,
  rpc:async action=>action==='history'?{turns:[{request_id:id,voice_input_available:true,prompt}]}:{config},
  voiceHistory:async({evidence})=>({evidence}),reserveRealtime:async()=>{},
 });
 assert.equal(spoken.answer_hint,text.reply);
});

test('a mixed turn continues its only exact list in both transports and clarifies between two lists',async()=>{
 const departments='read_departments';
 const departmentRows=Array.from({length:24},(_,i)=>({id:String(i),name:'Department '+i,status:i===23?'inactive':'active'}));
 const {caller}=source({snapshot:{tables:{departments:departmentRows}}});
 const b=createBusinessDispatcher({config,access,caller});
 const first=await b.execute(departments,{mode:'list',status:'active'},undefined,{withOutcome:true});
 const summary=await b.execute('read_asset_catalogue',{mode:'summary',outlet_id:id},undefined,{withOutcome:true});
 const turn={request_id:otherId,state:'completed',tool_state:'completed',evidence:{capability:'business_evidence',items:[summary,first]}};
 const history=async()=>({turns:[turn]});
 const page=await b.planTurn('下一页',history);
 assert.equal(page.operation,departments);assert.equal(page.page.args.status,'active');assert.equal(page.page.args.page,2);
 let count=0;
 const answer=await generateText({kind:'turn',model:config.model,prompt:'下一页'},'fixture-secret',{business:b,history,
  transport:async(_,init)=>{
   if(++count===1)return response([functionCall(departments,{status:'inactive',mode:'list',page:1},'next')]);
   const e=JSON.parse(JSON.parse(init.body).input.at(-1).output);
   assert.equal(e.total_matching,23);assert.deepEqual(e.rows.map(r=>r.name),['Department 20','Department 21','Department 22']);
   return response([{type:'message',content:[{type:'output_text',text:'第二页有三项：Department 20、Department 21、Department 22。'}]}]);
  },
 });
 assert.match(answer.reply,/Department 22/);
 const deps={caller,access,get:()=>undefined,rpc:async action=>action==='history'?{turns:[turn,
  {request_id:id,state:'cancelled',voice_input_available:true,prompt:'Halaman seterusnya'}]}:{config},
  reserveRealtime:async()=>{},voiceHistory:async({evidence})=>({evidence})};
 const spoken=await dispatch(voiceRequest(departments,{mode:'list',status:'inactive',page:1}),deps);
 assert.equal(spoken.requested_scope.status,'active');assert.equal(spoken.rows.length,3);assert.equal(spoken.page,2);
 const gated=createBusinessDispatcher({config,access,caller,loadConfig:async()=>({...config,capability_connections:{}})});
 await assert.rejects(gated.execute(departments,{mode:'list'},undefined,{prompt:'Next page',history}),{code:'capability_disconnected'});
 const second=await b.execute(departments,{mode:'list',status:'inactive'},undefined,{withOutcome:true});
 turn.evidence.items.push(second);
 const clarified=await generateText({kind:'turn',model:config.model,prompt:'Next page'},'fixture-secret',{business:b,history,
  transport:()=>assert.fail('No model submission needed for ambiguous pagination')});
 assert.equal(clarified.reply,'Which list would you like to continue?');
 const ambiguous=await dispatch(voiceRequest(departments,{}),deps);
 assert.equal(ambiguous.query_outcome,'AMBIGUOUS');assert.equal(ambiguous.not_business_evidence,true);
 turn.evidence=spoken;
 const end=await b.planTurn('Next page',history);
 assert.match(end.pagination_reply,/no such page/);
});

test('a current quantitative question with a unique READ owner requires source execution before answering',async()=>{
 const b=createBusinessDispatcher({config,access,caller:source().caller});
 const saved=[];
 const {reply}=await generateText({kind:'turn',model:config.model,prompt:'What is the Factory recipe version count?'},'fixture-secret',{
  business:b,onTool:(status,evidence)=>{if(evidence)saved.push(evidence);},
  transport:async(_,init)=>{
   const request=JSON.parse(init.body);
   assert.deepEqual(request.tool_choice,{type:'function',name:'read_factory_recipe_versions'});
   return response([{type:'message',content:[{type:'output_text',text:'There are exactly 999 versions. Which outlet should I check?'}]}]);
  },
 });
 assert.deepEqual(saved,[]);
 assert.match(reply,/couldn’t verify/);
 assert.doesNotMatch(reply,/999|outlet/);
 const disconnected=createBusinessDispatcher({config:{...config,capability_connections:{...config.capability_connections,read_factory_recipe_versions:false}},access});
 const denied=await generateText({kind:'turn',model:config.model,prompt:'What is the Factory recipe version count?'},'fixture-secret',{
  business:disconnected,transport:()=>assert.fail('A disconnected source must not require a provider call'),
 });
 assert.match(denied.reply,/access/);
});

test('after discovery alone Text can ask for source-supported scope without inventing an answer',async()=>{
 const b=createBusinessDispatcher({config,access,caller:source().caller});
 for(const [proposed,expected] of [
  ['Which outlet and period should I use?','Which outlet and period should I check?'],
  ['Purchase spend was RM 999. Which outlet and period should I use?',/couldn’t verify/],
  ['Which payroll password should I use?',/couldn’t verify/],
 ]){
  let calls=0;
  const {reply}=await generateText({kind:'turn',model:config.model,prompt:'Can you check the supplier purchases?'},'fixture-secret',{
   business:b,onTool:()=>assert.fail('Discovery alone cannot save business evidence'),
   transport:async()=>response(++calls===1?[functionCall('find_business_queries',{search:'supplier purchases',page:1},'discovery')]:
    [{type:'message',content:[{type:'output_text',text:proposed}]}]),
  });
  assert.equal(calls,2);
  if(typeof expected==='string')assert.equal(reply,expected);else assert.match(reply,expected);
  assert.doesNotMatch(reply,/999|password/);
 }
});

test('private recall and conceptual questions mentioning business measures keep their ordinary Text response',async()=>{
 const b=createBusinessDispatcher({config,access,caller:source().caller});
 for(const prompt of ['Hello','How is the Factory recipe version count calculated?',
  'Recall our previous conversation about the Factory recipe version count.']){
  const assembled=prompt.startsWith('Recall')?assembleContext({},[{title:'Recipe review',seq:2,prompt:'Review the saved recipe counts before Friday.'}]):undefined;
  const {reply}=await generateText({kind:'turn',model:config.model,prompt,assembled},'fixture-secret',{
   business:b,transport:async(_,init)=>{
    const body=JSON.parse(init.body);
    assert.equal(body.tool_choice,'auto');
    if(assembled)assert.match(body.instructions,/Review the saved recipe counts before Friday/);
    return response([{type:'message',content:[{type:'output_text',text:'Conversation reply.'}]}]);
   },
  });
  assert.equal(reply,'Conversation reply.');
 }
});

test('a fresh Factory count after a JYMT recommendation excludes the earlier task from both provider rounds',async()=>{
 const prior='Give JYMT recorded operating expenses and current asset count, and recommend one next check for interpreting cost.';
 const previous={seq:1,prompt:prior,reply:'Check whether all months have recorded expenses.',has_evidence:true};
 const assembled=assembleContext({context:[previous]});
 const {caller}=source({snapshot:{tables:{factory_product_recipes:[
  {id:'a1',product_name:'Product A',version:'v1',status:'active'},
  {id:'a2',product_name:'Product A',version:'v2',status:'draft'},
  {id:'b1',product_name:'Product B',version:'v1',status:'active'},
 ]}}});
 const business=createBusinessDispatcher({config,access,caller});
 for(const prompt of [
  'In Factory Product Recipes, how many products have active current recipe standards out of all current standards? How many saved recipe versions are active out of all saved versions, including earlier versions?',
  'What is the Factory recipe version count?',
 ]){
  let calls=0,saved;
  const answer=await generateText({kind:'turn',model:config.model,prompt,assembled},'fixture-secret',{
   business,
   history:async()=>({turns:[{...previous,state:'completed',tool_state:'completed',evidence:{items:[
    {capability:'read_operating_expenses',requested_scope:{year:2026}},{capability:'read_asset_catalogue',requested_scope:{mode:'summary'}},
   ]}}]}),
   onTool:(_,evidence)=>{if(evidence)saved=evidence;},
   transport:async(_,init)=>{
    const body=JSON.parse(init.body);
    assert.doesNotMatch(JSON.stringify(body.input),/JYMT|interpreting cost|expense|next check/i);
    assert.doesNotMatch(body.instructions,/recommend a concrete next check/i);
    assert.match(body.instructions,/equivalent populations, units and periods/i);
    if(++calls===1)return response([functionCall('read_factory_recipe_versions',{
     mode:'summary',measure:'versions',page:1,name:null,code:null,product_name:null,status:null,
    },'recipes')]);
    const evidence=JSON.parse(body.input.at(-1).output);
    assert.equal(evidence.recorded_versions.total,3);
    return response([{type:'message',content:[{type:'output_text',text:'1 of 2 current product recipe standards is active. 2 of 3 saved recipe versions are active.'}]}]);
   },
  });
  assert.equal(calls,2);
  assert.equal(saved.capability,'read_factory_recipe_versions');
  assert.match(answer.reply,/2 of 3 saved recipe versions/);
  assert.doesNotMatch(answer.reply,/JYMT|expense|recommend|next check/i);
 }
});

test('a reference to the same verified READ keeps its adjacent turn without replaying earlier unrelated user goals',async()=>{
 const business=createBusinessDispatcher({config,access});
 const previous='How many Factory recipe versions are saved?';
 const assembled=assembleContext({context:[
  {prompt:'Recommend one next check for JYMT operating costs.',reply:'Use only recorded months.',has_evidence:true},
  {prompt:previous,reply:'There were 3 saved versions.',has_evidence:true},
 ]});
 const history=async()=>({turns:[{state:'completed',tool_state:'completed',
  evidence:{capability:'read_factory_recipe_versions',requested_scope:{mode:'summary'}}}]});
 await generateText({kind:'turn',model:config.model,prompt:'How many of those Factory recipe versions are active?',assembled},'fixture-secret',{
  business,history,transport:async(_,init)=>{
   const body=JSON.parse(init.body);
   assert(body.input.some(item=>item.content===previous));
   assert.doesNotMatch(JSON.stringify(body.input),/JYMT|recorded months/i);
   return response([{type:'message',content:[{type:'output_text',text:'No source fetched.'}]}]);
  },
 });
});
