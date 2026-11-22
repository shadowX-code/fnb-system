import test from 'node:test';
import assert from 'node:assert/strict';
import { createSdkVoiceHistory } from './sdkVoiceHistory.js';
import { dispatch } from '../../../supabase/functions/native-assistant/handler.js';
import { createBusinessDispatcher } from '../../../supabase/functions/native-assistant/business.js';

test('Factory handoff keeps the same turn and saves the finalized answer before delayed playback cleanup', async () => {
 const steps = [];
 const history = createSdkVoiceHistory({
  id: () => 'turn',
  write: async (id, step, text) => steps.push([id, step, text]),
  read: async (id,args,operation) => { assert.equal(id, 'turn'); assert.equal(operation,'read_factory_finished_goods'); return { source: 'fixture' }; },
  state() {}, trace() {},
 });
 history.receive({ type: 'input_audio_buffer.committed', item_id: 'input' });
 history.receive({ type: 'response.created', response: { id: 'tool' } });
 assert.deepEqual(await history.tool({}, 'tool', 'read_factory_finished_goods'), { result: { source: 'fixture' } });
 assert.deepEqual(await history.tool({}, 'tool'), { stale: true });
 history.receive({ type: 'response.done', response: { id: 'tool', status: 'completed', output: [{ type: 'function_call' }] } });
 history.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'input', transcript: 'Check stock' });
 history.receive({ type: 'response.created', response: { id: 'answer' } });
 history.receive({ type: 'output_audio_buffer.started', response_id: 'answer' });
 history.receive({ type: 'output_audio_buffer.cleared', response_id: 'answer' });
 history.receive({ type: 'output_audio_buffer.cleared' });
 history.receive({ type: 'response.done', response: { id: 'tool', status: 'cancelled' } });
 history.receive({ type: 'output_audio_buffer.stopped', response_id: 'tool' });
 history.receive({ type: 'response.done', response: { id: 'answer', status: 'completed', output: [{ role: 'assistant', content: [{ type: 'output_audio', transcript: 'Stock checked.' }] }] } });
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(steps.at(-1)?.[1], 'complete');
 history.receive({ type: 'output_audio_buffer.stopped', response_id: 'answer' });
 history.receive({ type: 'output_audio_buffer.cleared', response_id: 'answer' });
 history.receive({ type: 'response.done', response: { id: 'answer', status: 'cancelled' } });
 await history.close();
 assert.deepEqual(steps, [['turn', 'start', ''], ['turn', 'input', 'Check stock'], ['turn', 'complete', 'Stock checked.']]);
});

test('an interrupted tool read cannot continue the old response after a new turn', async () => {
 let resolveRead, beginRead;
 const reading = new Promise(resolve => { beginRead = resolve; });
 const steps = [];
 let turn = 0;
 const history = createSdkVoiceHistory({
  id: () => ++turn,
  write: async (id, step) => steps.push([id, step]),
  read: () => new Promise(resolve => { resolveRead = resolve; beginRead(); }),
  state() {}, trace() {},
 });
 history.receive({ type: 'input_audio_buffer.committed', item_id: 'first' });
 history.receive({ type: 'response.created', response: { id: 'old' } });
 const pending = history.tool({}, 'old');
 await reading;
 history.receive({ type: 'input_audio_buffer.speech_started' });
 await Promise.resolve();
 assert.deepEqual(steps, [[1, 'start']]);
 history.receive({ type: 'input_audio_buffer.committed', item_id: 'second' });
 resolveRead({ source: 'fixture' });
 assert.deepEqual(await pending, { stale: true });
 await history.close();
 assert.deepEqual(steps, [[1, 'start'], [2, 'start'], [1, 'unfinished'], [2, 'unfinished']]);
});

test('only cancellation of the active response persists an interruption', async () => {
 const steps = [];
 const history = createSdkVoiceHistory({
  id: () => 'turn',
  write: async (id, step) => steps.push(step),
  state() {}, trace() {},
 });
 history.receive({ type: 'input_audio_buffer.committed', item_id: 'input' });
 history.receive({ type: 'response.created', response: { id: 'old' } });
 history.receive({ type: 'response.created', response: { id: 'answer' } });
 history.receive({ type: 'output_audio_buffer.started', response_id: 'answer' });
 history.receive({ type: 'output_audio_buffer.cleared', response_id: 'answer' });
 history.receive({ type: 'response.done', response: { id: 'old', status: 'cancelled' } });
 await new Promise(resolve => setImmediate(resolve));
 assert.deepEqual(steps, ['start']);
 history.receive({ type: 'response.done', response: { id: 'answer', status: 'cancelled' } });
 await history.close();
 assert.deepEqual(steps, ['start', 'interrupted']);
});

test('incomplete speech preserves actual partial transcript and the sanitized provider reason', async () => {
 const steps=[];
 const history=createSdkVoiceHistory({id:()=> 'turn',write:async(...args)=>steps.push(args),state(){},trace(){}});
 history.receive({type:'input_audio_buffer.committed',item_id:'input'});
 history.receive({type:'response.created',response:{id:'answer'}});
 history.receive({type:'response.output_audio_transcript.done',response_id:'answer',transcript:'我可以帮你查看'});
 history.receive({type:'response.done',response:{id:'answer',status:'incomplete',status_details:{reason:'max_output_tokens'},output:[]}});
 await history.close();
 assert.deepEqual(steps.at(-1),['turn','unfinished','我可以帮你查看',{reason:'max_output_tokens'}]);
});

test('a new input commit cannot discard a late finalized response belonging to the earlier turn', async () => {
 const steps=[];let turn=0;
 const history=createSdkVoiceHistory({id:()=> ++turn,write:async(...args)=>steps.push(args),state(){},trace(){}});
 history.receive({type:'input_audio_buffer.committed',item_id:'one'});
 history.receive({type:'response.created',response:{id:'answer'}});
 history.receive({type:'input_audio_buffer.committed',item_id:'two'});
 history.receive({type:'response.done',response:{id:'answer',status:'completed',output:[{role:'assistant',content:[{type:'output_audio',transcript:'完整回复'}]}]}});
 await history.close();
 assert.deepEqual(steps.find(s=>s[0]===1&&s[1]==='complete'),[1,'complete','完整回复',{reason:'provider_completed'}]);
 assert.equal(steps.filter(s=>s[0]===1&&s[1]==='unfinished').length,0);
});

test('denied tool returns a speakable explanation without retrying or ending the SDK session',async()=>{
 let reads=0;
 const history=createSdkVoiceHistory({id:()=> 'turn',write:async()=>{},read:async()=>{reads++;throw Object.assign(Error('denied'),{code:'factory_read_denied'});},state(){},trace(){}});
 history.receive({type:'input_audio_buffer.committed',item_id:'one'});history.receive({type:'response.created',response:{id:'tool'}});
 const {result}=await history.tool({},'tool','read_factory_finished_goods');
 assert.equal(result.operation,'read_factory_finished_goods');
 assert.match(result.reason,/permissions or scope deny/);
 assert.deepEqual(await history.tool({},'tool'),{stale:true});assert.equal(reads,1);
 history.receive({type:'response.done',response:{id:'tool',status:'completed',output:[{type:'function_call'}]}});
 history.receive({type:'response.created',response:{id:'answer'}});
 history.receive({type:'response.done',response:{id:'answer',status:'completed',output:[{role:'assistant',content:[{type:'output_audio',transcript:'我无法读取目前的库存。'}]}]}});
 await history.close();
});

test('HR discovery, corrected arguments, and completed speech use the same evidence as text dispatch', async () => {
 const session = '249ec7e0-df75-4145-8a34-ec2baf82f9ef';
 const employee = 'read_employee_directory';
 const config = {enabled:true,capability_connections:{[employee]:true}};
 const access = {permissions:{'employees.view':true}};
 const evidence = [];
 const traces = [];
 const steps = [];
 let reads = 0;
 const response = {summary:{total:3,active:2,inactive:1,resigned:1,terminated:0,other:0},
  employment_types:{full_time:2,probation:1},rows:[],total_count:3,aggregate_complete:true,schema_version:2};
 const caller = {rpc(name, args) {
  return {async abortSignal() {
   if (name === 'current_user_has_permission') return {data:args.permission_code === 'employees.view'};
   assert.equal(name,'employee_directory_query');
   assert.equal(args.p_mode,'summary');
   assert.equal(args.p_outlet_id,null);
   reads++;
   return {data:response};
  }};
 }};
 const ctx = {access,caller,rpc:async()=>({config}),get:()=>undefined,reserveRealtime:async()=>{},
  voiceHistory:async payload=>evidence.push(payload.evidence),traceVoice:(event,trace)=>traces.push([event,trace])};
 const read = (turn_id, args, operation) => dispatch({
  action:'realtime_tool',provider:'openai',session_id:session,request_id:session,turn_id,operation,arguments:args,
 },ctx);
 const history = createSdkVoiceHistory({id:()=>session,write:async(...args)=>steps.push(args),read,state(){},trace(){}});
 const created = id => history.receive({type:'response.created',response:{id}});
 const doneTool = id => history.receive({type:'response.done',response:{id,status:'completed',output:[{type:'function_call'}]}});
 history.receive({type:'input_audio_buffer.committed',item_id:'first'});
 created('discover');
 const discovered = await history.tool({search:'employees',page:1},'discover','find_business_queries');
 assert.equal(discovered.result.operations[0].operation,employee);
 doneTool('discover');
 created('bad');
 const invalid = await history.tool({operation:employee,arguments_json:'{"mode":"count"}'},'bad','run_business_query');
 assert.equal(invalid.result.error,'tool_arguments_invalid');
 assert.equal(invalid.result.operation,employee);
 assert(invalid.result.parameters.properties.mode.enum.includes('summary'));
 assert.equal(reads,0);
 assert.equal(evidence.length,0);
 doneTool('bad');
 created('corrected');
 const args = {operation:employee,arguments_json:'{"mode":"summary"}'};
 assert.deepEqual(await history.tool(args,'bad','run_business_query'),{stale:true});
 const {result} = await history.tool(args,'corrected','run_business_query');
 doneTool('corrected');
 created('answer');
 history.receive({type:'response.done',response:{id:'answer',status:'completed',
  output:[{role:'assistant',content:[{type:'output_audio',transcript:'共有三位员工，其中两位在职。'}]}]}});
 await history.close();
 assert.equal(steps.at(-1)[1],'complete');
 assert.equal(reads,1);
 assert.deepEqual(evidence,[result]);
 const text = await createBusinessDispatcher({caller,config,access}).execute('run_business_query',args);
 assert.deepEqual(result.summary,text.summary);
 assert.deepEqual(result.employment_types,{full_time:2,probation:1});
 assert.equal(result.completeness.aggregate_scope,'complete_filtered_scope');
 assert.deepEqual(traces.at(-1)[1].arguments_shape,{fields:['mode'],mode:'summary',unsupported_field_count:0});
 ctx.access = {};
 await assert.rejects(read(session,args,'run_business_query'),{code:'business_read_denied',diagnostic:{operation:employee,operation_label:'Employee headcount and directory',stage:'dispatch',query_outcome:'UNAUTHORIZED'}});
 ctx.access = access;
 config.capability_connections[employee]=false;
 await assert.rejects(read(session,args,'run_business_query'),{code:'capability_disconnected',diagnostic:{operation:employee,operation_label:'Employee headcount and directory',stage:'dispatch',query_outcome:'UNAUTHORIZED'}});
 await assert.rejects(read(session,{query:'',availability:'all'},undefined),{code:'tool_not_allowed'});
 assert.equal(evidence.length,1);
});

test('employee permission failures identify the attempted capability and allow a spoken denial', async () => {
 const steps=[];
 const history=createSdkVoiceHistory({id:()=> 'turn',write:async(...step)=>steps.push(step),
  read:async()=>{throw Object.assign(Error('private server detail'),{code:'business_read_denied',
   diagnostic:{operation:'read_employee_directory',operation_label:'Employee headcount and directory',stage:'dispatch'}});},state(){},trace(){}});
 history.receive({type:'input_audio_buffer.committed',item_id:'one'});
 history.receive({type:'response.created',response:{id:'tool'}});
 const {result}=await history.tool({operation:'read_employee_directory'},'tool','run_business_query');
 assert.equal(result.operation,'read_employee_directory');
 assert.equal(result.error,'business_read_denied');
 assert.equal(result.no_evidence,true);
 assert.doesNotMatch(JSON.stringify(result),/factory|private server detail/i);
 history.receive({type:'response.done',response:{id:'tool',status:'completed',output:[{type:'function_call'}]}});
 history.receive({type:'response.created',response:{id:'answer'}});
 history.receive({type:'response.done',response:{id:'answer',status:'completed',output:[{role:'assistant',content:[{type:'output_audio',transcript:'The current scope does not permit this employee read.'}]}]}});
 await history.close();
 assert.equal(steps.at(-1)[1],'complete');
});


test('transport loss preserves observed transcript deltas and its distinct termination reason',async()=>{
 const steps=[];
 const history=createSdkVoiceHistory({id:()=> 'turn',write:async(...args)=>steps.push(args),state(){},trace(){}});
 history.receive({type:'input_audio_buffer.committed',item_id:'one'});history.receive({type:'response.created',response:{id:'answer'}});
 history.receive({type:'response.output_audio_transcript.delta',response_id:'answer',delta:'实际'});
 history.receive({type:'response.output_audio_transcript.delta',response_id:'answer',delta:'部分'});
 await history.close('transport_disconnected');
 assert.deepEqual(steps.at(-1),['turn','unfinished','实际部分',{reason:'transport_disconnected'}]);
});
