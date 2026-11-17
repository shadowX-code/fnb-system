import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {operations,createBusinessDispatcher,businessCapabilities,modulePolicyMembers,validateBusinessArguments} from './business.js';
import {readInventory,inventoryArguments} from '../_shared/factory/finishedGoodsRead.js';
import {employeeDirectoryRead} from '../_shared/people/employeeDirectoryRead.js';
import {domainQueryInstructions} from '../_shared/assistant/moduleInterface.js';
import {voiceInstructions} from './realtime.js';
import {generateText} from './provider.js';
import {validateBody} from './handler.js';
const factory='read_factory_finished_goods';
function inventoryCaller(rows){return {rpc:name=>{const value={data:name==='current_user_role_id'?'role':name==='current_user_has_permission'?true:rows.map(r=>r.id)};return {then:f=>Promise.resolve(value).then(f),abortSignal:async()=>value};},from:()=>({select:()=>({in:(_key,ids)=>({abortSignal:async()=>({data:rows.filter(r=>ids.includes(r.id))})})})})};}
test('Factory count, pagination, exact SKU detail and legacy arguments share one authority',async()=>{
 const rows=Array.from({length:45},(_,i)=>({id:String(i).padStart(2,'0'),product_code:'SKU'+i,product_name:'Product '+String(i).padStart(2,'0'),current_balance:i,min_stock_level:10}));
 const caller=inventoryCaller(rows),base={query:'',availability:'all'};
 const legacy=await readInventory(caller,base),p2=await readInventory(caller,{...base,mode:'list',page:2,sku:null}),summary=await readInventory(caller,{...base,mode:'summary',page:1,sku:null});
 assert.equal(summary.total_matching,45);assert.equal(summary.rows.length,0);assert.equal(p2.rows.length,20);assert.equal(p2.total_matching,45);assert(!p2.rows.some(r=>legacy.rows.some(l=>l.id===r.id)));
 const detail=await readInventory(caller,{...base,mode:'detail',page:1,sku:'SKU24'});assert.equal(detail.rows[0].id,'24');assert.equal(detail.detail_found,true);
 const low=await readInventory(caller,{...base,availability:'low'});assert.equal(low.total_matching,10);
 assert.throws(()=>inventoryArguments({...base,mode:'detail',sku:null}));assert.throws(()=>inventoryArguments({...base,outlet_id:'arbitrary'}));
});
test('employee modes preserve old callers and reject unsupported filters; migration does not rewrite access',()=>{
 const a={mode:'summary',employee_id:null,status:'all',legal_entity_id:null,workplace:null,query:'',page:1};
 assert.equal(employeeDirectoryRead.validate(a).outlet_id,null);
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
 const b=createBusinessDispatcher({config,access,readFactory:async()=>{reads++;return {capability:factory,total_matching:45};},loadConfig:async()=>config});
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
 const b=createBusinessDispatcher({config,access,readFactory:async()=>({capability:factory,total_matching:45})});let n=0;const evidence=[];
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
 const result=await b.execute('run_business_query',{operation:'read_employee_directory',arguments_json:'{"mode":"summary"}'});
 assert.equal(result.error,'tool_arguments_invalid');assert(result.not_business_evidence);assert.equal(result.parameters.additionalProperties,false);assert.equal(called,0);
 await assert.rejects(createBusinessDispatcher({config,access:{}}).execute('run_business_query',{operation:'read_employee_directory',arguments_json:'{"mode":"summary"}'}),{code:'business_read_denied'});
});
