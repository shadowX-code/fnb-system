import test from 'node:test';import assert from 'node:assert/strict';
import {generateText} from './provider.js';import {inventoryArguments,callerAccess,readInventory} from './inventory.js';import {voiceConnection,voiceRequest} from './voice.js';import {validateBody,dispatch} from './handler.js';
const response=data=>new Response(JSON.stringify(data));
const claim={kind:'turn',model:'gpt-4o-mini',prompt:'Check Finished Goods',context:[]};
test('real transport contract routes one fixed tool, carries authoritative evidence and sums both usages (fixture)',async()=>{
 const statuses=[],bodies=[];let n=0;
 const r=await generateText(claim,'fixture-key',{onTool:(...x)=>statuses.push(x),readTool:async args=>{assert.deepEqual(args,{query:'',availability:'all'});return {capability:'read_factory_finished_goods',as_of:'fixture-time',rows:[{product_name:'Fixture',current_balance:4}]};},transport:async(_,init)=>{bodies.push(JSON.parse(init.body));return response(++n===1?{status:'completed',output:[{type:'function_call',name:'read_factory_finished_goods',call_id:'fixture-call',arguments:'{"query":"","availability":"all"}'}],usage:{input_tokens:40,output_tokens:20}}:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Fixture has 4 units.'}]}],usage:{input_tokens:80,output_tokens:10}});}});
 assert.equal(r.reply,'Fixture has 4 units.');assert.equal(r.input_tokens,120);assert.equal(r.output_tokens,30);assert.deepEqual(statuses.map(x=>x[0]),['executing','completed']);assert.equal(bodies[1].tools,undefined);assert.equal(bodies[1].store,false);assert(bodies[1].input.at(-1).output.includes('fixture-time'));
});
test('rejects arbitrary tools and arguments; errors never become inventory evidence',async()=>{
 assert.throws(()=>inventoryArguments({query:'',availability:'all',company_id:'unapproved'}));
 const transport=async()=>response({status:'completed',output:[{type:'function_call',name:'arbitrary_sql',call_id:'x',arguments:'{}'}]});
 await assert.rejects(generateText(claim,'fixture',{readTool:()=>{throw Error('must not run');},transport}),{code:'tool_not_allowed'});
});
test('denies missing human permission before snapshot/table reads (fixture)',async()=>{
 let count=0;const caller={rpc:async name=>{count++;return {data:name==='current_user_role_id'?'role-fixture':false};},from:()=>{throw Error('unauthorized table access');}};
 assert.equal((await callerAccess(caller)).factory,false);await assert.rejects(readInventory(caller,{query:'',availability:'low'}),{code:'factory_read_denied'});assert.equal(count,4);
});
test('scope-stable bounded canonical reads distinguish unknown minimums and include provenance (fixture)',async()=>{
 const rows=[{id:'a',product_name:'Fixture A',current_balance:2,min_stock_level:3},{id:'b',product_name:'Fixture B',current_balance:0,min_stock_level:null},{id:'c',product_name:'Fixture C',current_balance:9,min_stock_level:0}];
 const caller={rpc:(name)=>{const value={data:name==='current_user_role_id'?'fixture-role':name==='current_user_has_permission'?true:rows.map(x=>x.id)};return {then:fn=>Promise.resolve(value).then(fn),abortSignal:()=>Promise.resolve(value)};},from:()=>({select:()=>({in:()=>({abortSignal:async()=>({data:rows})})})})};
 const r=await readInventory(caller,{query:'',availability:'low'});assert.equal(r.total_matching,1);assert.equal(r.unknown_minimum_count,2);assert.equal(r.total_scoped_products,3);assert.equal(r.rows[0].id,'a');assert.equal(r.source,'/factory/warehouse/finished-goods');assert(r.as_of);assert.match(r.limitations,/absent\/zero minimum is unknown/);
});
test('voice is fail-closed, fixed configuration only, not implicit model/domain-key fallback',async()=>{
 assert.equal(voiceConnection(()=>undefined).ready,false);assert.equal(voiceConnection(k=>({NATIVE_ASSISTANT_VOICE_URL:'http://localhost:8080',NATIVE_ASSISTANT_VOICE_KEY:'x'.repeat(32),NATIVE_ASSISTANT_VOICE_APPROVED_USE:'native-assistant-staging-voice'}[k])).ready,false);
 await assert.rejects(voiceRequest('/stt',{},()=>undefined),{code:'voice_not_configured'});
 assert.throws(()=>validateBody({action:'voice_tts',text:'arbitrary text'}));assert.throws(()=>validateBody({action:'features',voice_enabled:true,factory_reads_enabled:true,expected_revision:1,endpoint:'https://evil.test'}));
});
test('voice uses exact remote contract, rejects redirected/error/body diagnostics and invalid readiness (fixture)',async()=>{
 const get=k=>({NATIVE_ASSISTANT_VOICE_URL:'https://voice.example/',NATIVE_ASSISTANT_VOICE_KEY:'fixture'.repeat(8),NATIVE_ASSISTANT_VOICE_APPROVED_USE:'native-assistant-staging-voice'}[k]);
 await assert.rejects(voiceRequest('/ready',{},get,{transport:async()=>response({stt:'wrong',tts:'jarvis-high'})}),{code:'voice_runtime_invalid'});
 await assert.rejects(voiceRequest('/stt',{},get,{transport:async()=>new Response('upstream SECRET',{status:500})}),e=>e.code==='voice_runtime_unavailable'&&!e.message.includes('SECRET'));
 let init;await voiceRequest('/ready',{},get,{transport:async(_,options)=>{init=options;return response({stt:'whisper-base',tts:'kokoro-bm_george'});}});assert.equal(init.redirect,'error');
});
