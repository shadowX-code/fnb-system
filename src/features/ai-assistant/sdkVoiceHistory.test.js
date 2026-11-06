import test from 'node:test';
import assert from 'node:assert/strict';
import { createSdkVoiceHistory } from './sdkVoiceHistory.js';

test('Factory handoff keeps the same turn and saves the finalized answer before delayed playback cleanup', async () => {
 const steps = [];
 const history = createSdkVoiceHistory({
  id: () => 'turn',
  write: async (id, step, text) => steps.push([id, step, text]),
  read: async id => { assert.equal(id, 'turn'); return { source: 'fixture' }; },
  state() {}, trace() {},
 });
 history.receive({ type: 'input_audio_buffer.committed', item_id: 'input' });
 history.receive({ type: 'response.created', response: { id: 'tool' } });
 assert.deepEqual(await history.tool({}, 'tool'), { evidence: { source: 'fixture' } });
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
 assert.match((await history.tool({},'tool')).error,/access was denied/);
 assert.deepEqual(await history.tool({},'tool'),{stale:true});assert.equal(reads,1);
 history.receive({type:'response.done',response:{id:'tool',status:'completed',output:[{type:'function_call'}]}});
 history.receive({type:'response.created',response:{id:'answer'}});
 history.receive({type:'response.done',response:{id:'answer',status:'completed',output:[{role:'assistant',content:[{type:'output_audio',transcript:'我无法读取目前的库存。'}]}]}});
 await history.close();
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
