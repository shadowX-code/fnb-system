import test from 'node:test';
import assert from 'node:assert/strict';
import {businessCapabilities,createBusinessDispatcher,operations} from './business.js';
import {dispatch} from './handler.js';
import {generateText} from './provider.js';
import {knowledgeResult} from '../_shared/assistant/knowledge.js';
import {finishedGoodsRead,inventoryArguments} from '../_shared/factory/finishedGoodsRead.js';

const id='10000000-0000-4000-8000-000000000001';
const other='10000000-0000-4000-8000-000000000002';
const version='10000000-0000-4000-8000-000000000003';
const published='2026-05-01T00:00:00Z';
const config={enabled:true,capability_connections:Object.fromEntries(operations.map(op=>[op.id,true]))};
const access={admin:true,factory:true,permissions:Object.fromEntries(operations.map(op=>[op.permission,true]))};
const envelope=(operation,args)=>({operation,arguments_json:JSON.stringify(args)});
const sop='read_crew_published_sop',factory='read_factory_sop_versions',fg='read_factory_finished_goods';
const brand='read_marketing_knowledge_sources',faq='read_marketing_usable_faq',template='read_published_contract_templates';
const guide='read_assistant_system_guidance';
const authError={error:{code:'42501'}};
const request=(name,args,call_id)=>({type:'function_call',name,call_id,arguments:JSON.stringify(args)});
const response=output=>Response.json({status:'completed',output,usage:{input_tokens:80,output_tokens:20}});
const doc=(n,body,extras={})=>({id:n===2?version:other,version:n,status:'published',published_at:published,sections:[{id,title:'Close',body,media_url:'SECRET_MEDIA'}],...extras});
const crewRow={id,title:'Workstation cleanliness',status:'published',current_version:2,outlet_id:id,versions:[doc(2,'Sanitize the benches.'),doc(1,'Historical cleaning procedure.'),doc(3,'DRAFT TEXT',{status:'draft'})]};
const makeCaller=state=>({
 rpc(name,args){
  state.calls?.push([name,args]);
  const permissions=name==='current_user_has_permission';
  const result=permissions?{data:state.permission!==false}:state.rpcs[name]?.(args);
  assert(result,`Unexpected source ${name}`);
  return {abortSignal:async()=>result};
 },
 from(name){
  state.calls?.push([name]);
  let rows=[...(state.tables?.[name]||[])];
  const builder={select(){return this;},order(){return this;},limit(size,options){if(!options)rows=rows.slice(0,size);return this;},
   eq(key,value){rows=rows.filter(row=>row[key]===value);return this;},
   ilike(key,value){rows=rows.filter(row=>row[key]?.toLowerCase()===value.toLowerCase());return this;},
   in(key,values){rows=rows.filter(row=>values.includes(row[key]));return this;},
   range(start,end){rows=rows.slice(start,end+1);return this;},
   abortSignal:async()=>({data:rows}),
  };
  return builder;
 },
});
const dispatcher=(state,options={})=>createBusinessDispatcher({config,access,caller:makeCaller(state),...options});

test('keyword and concept retrieval label their evidence and return no unrelated content',()=>{
 const document={document_id:id,version_id:version,version:2,state:'published_current',title:'Workstation cleanliness',sections:[{id,title:'Sanitize',text:'<p>Sanitize the benches.</p><script>SECRET</script>'}]};
 const keyword=knowledgeResult('benches',[document],{scope:{outlet_id:id}});
 assert.equal(keyword.knowledge.citations[0].match,'keyword');
 const concept=knowledgeResult('卫生',[document],{scope:{outlet_id:id}});
 assert.equal(concept.knowledge.citations[0].match,'concept');
 assert.equal(concept.knowledge.citations[0].excerpt,'Sanitize the benches.');
 assert.deepEqual(knowledgeResult('astronomy',[document],{}).knowledge.citations,[]);
});

test('Crew checks pinned publication, historical versions, future effective dates and revocation at the source',async()=>{
 let row=structuredClone(crewRow);
 const state={rpcs:{crew_sop_admin_detail:()=>({data:row}),crew_sop_admin_library:()=>({data:{sops:[row]}})},tables:{outlets:[{id,name:'Friends Corner',code:'FC'}]}};
 const business=dispatcher(state);
 const search={outlet_id:other,outlet_name:'Friends Corner',query:'sanitation'};
 const first=await business.execute(sop,search);
 assert.equal(first.knowledge.scope.outlet_id,id);
 assert.equal(first.knowledge.citations[0].version,2);
 assert.doesNotMatch(JSON.stringify(first),/SECRET_MEDIA|DRAFT TEXT|Historical cleaning/);
 const historical=await business.execute(sop,{sop_id:id,version:1});
 assert.equal(historical.knowledge.citations[0].state,'published_historical');
 row.current_version=3;assert.equal((await business.execute(sop,search)).knowledge.status,'no_current_version');
 row.versions[2]={...doc(3,'Future procedure'),effective_date:'2099-12-31'};
 assert.equal((await business.execute(sop,search)).knowledge.status,'no_current_version');
 row.versions[2]=doc(3,'Sanitize the new benches.');
 assert.equal((await business.execute(sop,search)).knowledge.citations[0].version,3);
 row.status='archived';assert.deepEqual((await business.execute(sop,{sop_id:id})).knowledge.citations,[]);
 row.status='published';row.outlet_id=other;
 await assert.rejects(business.execute(sop,{sop_id:id,outlet_id:id}),{code:'knowledge_scope_unresolved'});
 state.rpcs.crew_sop_admin_detail=()=>authError;
 await assert.rejects(business.execute(sop,{sop_id:id}),{code:'business_read_denied'});
});

test('knowledge scopes do not discover ambiguous or unapproved sources',async()=>{
 const state={calls:[],rpcs:{crew_sop_admin_library:()=>({data:{sops:[crewRow,{...crewRow,id:other}]}})}};
 const business=dispatcher(state);
 const result=await business.execute(sop,{outlet_id:id,query:crewRow.title});
 assert.equal(result.knowledge.status,'ambiguous_source');
 assert.deepEqual(result.knowledge.citations,[]);
 assert(!state.calls.some(([name])=>name==='crew_sop_admin_detail'));
 state.permission=false;
 await assert.rejects(business.execute(sop,{outlet_id:id,query:crewRow.title}),{code:'business_read_denied'});
});

test('Onboarding retrieves current outlet narrative without assessments, media or other outlets',async()=>{
 const block=(block_type,body)=>({id,block_type,payload:{body}});
 const lesson={title:'Cleaning station',blocks:[block('text','Sanitize the benches.'),block('quiz','PRIVATE_ANSWER'),block('video','PRIVATE_MEDIA')]};
 const journey={id,name:'Welcome',version:2,is_mandatory_onboarding:true,status:'published',outlet_id:id,published_at:published,
  modules:[{title:'Week One',lessons:[lesson]}]};
 let current=journey;
 const state={rpcs:{crew_admin_onboarding_list:()=>({data:[{...journey,id:version,version:1},journey,{...journey,id:other,outlet_id:other,version:7}]}),
  crew_admin_onboarding_detail:args=>args.p_journey_id===id?{data:current}:authError}};
 const b=dispatcher(state),op='read_crew_onboarding_catalogue';
 const result=await b.execute(op,{outlet_id:id,query:'kebersihan'});
 assert.equal(result.knowledge.citations[0].version,2);
 assert.equal(result.knowledge.citations[0].match,'concept');
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 current={...journey,status:'archived'};
 assert.equal((await b.execute(op,{outlet_id:id,query:'kebersihan'})).knowledge.status,'no_current_version');
});

test('Brand requires the same current verified field revision, scope and consent; FAQ excludes draft and stale answers',async()=>{
 let eligibility={policy:{ai_allowed:true},knowledge:{revision:2,approved_for_replies:true},faqs:[
  {id,status:'approved',is_active:true,use_issue:null,knowledge_revision:2,question:'What is your brand name?',answer:'Fixture Brand',revision:4},
  {id:other,status:'draft',is_active:true,use_issue:null,knowledge_revision:2,question:'Draft brand name',answer:'DRAFT_ANSWER',revision:4},
  {id:other,status:'approved',is_active:true,use_issue:null,knowledge_revision:1,question:'Old brand name',answer:'STALE_ANSWER',revision:1},
 ]};
 const state={rpcs:{
  marketing_brand_context:()=>({data:{brands:[{id,name:'Fixture Brand'}]}}),
  marketing_faq_settings_read:args=>args.p_brand===id?{data:eligibility}:authError,
  marketing_knowledge_workspace:args=>args.p_brand===id?{data:{knowledge_approval_revision:2,knowledge:[{brand_id:id,revision:2,profile:{
   identity:{text:'Fixture Brand',provenance:'verified_brand_fact'},audience:{text:'UNVERIFIED',provenance:'external_research'},pricing:{text:'STALE_PRICE',provenance:'verified_brand_fact'},
  }}]}}:authError,
 }};
 const b=dispatcher(state);
 const k=(await b.execute(brand,{brand_name:'Fixture Brand',query:'brand identity'})).knowledge;
 assert.equal(k.citations[0].version,2);assert.doesNotMatch(JSON.stringify(k),/UNVERIFIED|STALE_PRICE/);
 assert.equal((await b.execute(faq,{brand_id:id,query:'brand name'})).knowledge.citations.length,1);
 eligibility={...eligibility,knowledge:{revision:3,approved_for_replies:false}};
 assert.deepEqual((await b.execute(faq,{brand_id:id,query:'brand name'})).knowledge.citations,[]);
 assert.equal((await b.execute(brand,{brand_id:id,query:'brand identity'})).knowledge.status,'no_current_version');
 eligibility.policy.ai_allowed=false;
 assert.equal((await b.execute(brand,{brand_id:id,query:'brand identity'})).knowledge.status,'source_ai_not_allowed');
 await assert.rejects(b.execute(faq,{brand_id:other}),{code:'business_read_denied'});
});

test('HR returns only current unfilled clauses within the canonical Legal Entity and effective policies',async()=>{
 const current={id:version,status:'published',version_number:4,published_at:published,sections:[{heading:'Notice period',body:'Notice per the template terms.',personal:'PRIVATE'}]};
 const state={rpcs:{
  employment_contract_templates_for_legal_entity:({p_legal_entity_id})=>p_legal_entity_id===id?{data:[
   {id,legal_entity_id:id,title:'Standard contract',is_active:true,current_published_version_id:version,current_published_version:current,versions:[{text:'DRAFT'}]},
   {id:other,legal_entity_id:other,title:'Wrong employer',is_active:true,current_published_version_id:version,current_published_version:{...current,sections:[{heading:'Notice',body:'CROSS_ENTITY'}]}},
  ]}:authError,
  payroll_ph_policy_read:({p_legal_entity_id})=>p_legal_entity_id===id?{data:[
   {id:other,legal_entity_id:id,effective_from:'2026-01-01',treatment:'legacy',formula_version:'v1'},
   {id,legal_entity_id:id,effective_from:'2026-05-01',treatment:'current_treatment',formula_version:'v2'},
   {id:version,legal_entity_id:id,effective_from:'2099-01-01',treatment:'future',formula_version:'v3'},
  ]}:authError,
 }};
 const b=dispatcher(state);
 const k=(await b.execute(template,{legal_entity_id:id,query:'resignation'})).knowledge;
 assert.equal(k.citations[0].version,4);
 assert.doesNotMatch(JSON.stringify(k),/PRIVATE|DRAFT|CROSS_ENTITY/);
 const policy='read_payroll_holiday_policy';
 assert.equal((await b.execute(policy,{legal_entity_id:id,query:'holiday'})).knowledge.citations[0].version,'v2');
 assert.equal((await b.execute(policy,{legal_entity_id:id,query:'holiday',effective_on:'2026-03-01'})).knowledge.citations[0].current,false);
 await assert.rejects(b.execute(template,{legal_entity_id:other}),{code:'business_read_denied'});
});

test('Text and SDK tools share Factory knowledge and live stock evidence; drafts and archived SOPs cannot replace current',async()=>{
 const state={rpcs:{},tables:{factory_production_sops:[
  {id,title:'Black Pepper Sauce Production SOP',product_name:'Black Pepper Sauce',status:'active',version:'v2',effective_date:'2026-05-01',recipe_version:'v3',
   steps:[{id,step_no:1,process_name:'Mix',instruction:'Mix for five minutes.'}]},
  {id:other,title:'Black Pepper Sauce Production SOP',product_name:'Black Pepper Sauce',status:'archived',version:'v1',steps:[{id,step_no:1,instruction:'ARCHIVED RULE'}]},
 ]}};
 const b=dispatcher(state,{readFactory:async()=>({capability:fg,rows:[{product_code:'S01',current_balance:62,uom:'kg'}]})});
 const question='What is current Factory Finished Goods stock for Black Pepper Sauce and the current Factory Production SOP instruction?';
 const plan=b.toolsForPrompt(question).map(tool=>tool.name);
 assert(plan.includes(factory));assert(plan.includes(fg));
 const params={query:'Black Pepper Sauce',page:1,sop_id:other};
 const captured=[];let n=0;
 const answer=await generateText({prompt:question,model:'gpt-4o-mini',kind:'turn'},'fixture-provider',{
  business:b,onTool:(status,evidence)=>{if(status==='completed')captured.push(evidence);},
  transport:async(_,init)=>{
   const body=JSON.parse(init.body);
   if(++n===1)return response([request(fg,{mode:'list',query:'Black Pepper Sauce'},'fg')]);
   if(n===2)return response([request(factory,params,'sop')]);
   const evidence=JSON.parse(body.input.at(-1).output);
   assert.equal(evidence.knowledge.citations[0].version,'v2');
   return response([{type:'message',content:[{type:'output_text',text:'62 kg in Finished Goods. Production SOP v2, Mix: Mix for five minutes.'}]}]);
  },
 });
 assert.match(answer.reply,/62 kg/);assert.equal(captured.length,2);assert.doesNotMatch(JSON.stringify(captured),/ARCHIVED RULE/);
 const saved=[];
 const out=await dispatch({action:'realtime_tool',provider:'openai',session_id:id,turn_id:id,request_id:id,operation:'run_business_query',arguments:envelope(factory,params)},{
  caller:makeCaller(state),access,get:()=>undefined,rpc:async()=>({config}),reserveRealtime:async()=>{},
  voiceHistory:async value=>saved.push(value.evidence),
 });
 assert.deepEqual(out.knowledge,captured[1].knowledge);
 assert.deepEqual(saved,[out]);
 assert.equal((await b.execute(factory,{sop_id:other})).knowledge.status,'no_current_version');
});

test('mixed stock and knowledge requests keep the explicit SKU and do not convert ranking intent',()=>{
 const args={mode:'summary',page:1,sku:'S01',query:null,sort:'balance_desc',uom:''};
 const expected={mode:'detail',page:1,sku:'S01',query:'',sort:'name',uom:null,availability:'all'};
 assert.deepEqual(inventoryArguments(args),expected);
 assert.deepEqual(inventoryArguments(finishedGoodsRead.scopeTextArguments({...args,sku:null,page:0},
  'Show current Finished Goods stock for SKU S01 and the published SOP.')),expected);
 assert.equal(finishedGoodsRead.scopeTextArguments(args,'Compare stock for SKU S01 against last month.'),args);
});

test('source declarations are discoverable through the current policy, with guide independent of business READ policy',async()=>{
 const managed=operations.filter(o=>o.knowledge);
 assert(managed.length>=7);
 for(const op of managed){
  assert.equal(op.kind,'READ');
  assert(op.knowledge.publication&&op.moduleInterface.knowledge.evidence&&op.source);
  const excluded=createBusinessDispatcher({config:{...config,capability_connections:{}},access});
  assert.equal((await excluded.execute('find_business_queries',{search:op.id,page:1})).operations.length,0);
 }
 const b=createBusinessDispatcher({config,access});
 assert.equal((await b.execute(guide,{query:'Personal memory'})).knowledge.citations[0].version,'1');
 await assert.rejects(createBusinessDispatcher({config,access:{}}).execute(guide,{query:'History'}),{code:'business_read_denied'});
 assert(!businessCapabilities(config,access).some(op=>op.id===guide));
});
