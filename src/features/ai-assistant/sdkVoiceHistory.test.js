import test from 'node:test';
import assert from 'node:assert/strict';
import { createSdkVoiceHistory } from './sdkVoiceHistory.js';

test('Factory handoff keeps the same turn and saves a completed answer only after playback', async () => {
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
 history.receive({ type: 'response.done', response: { id: 'tool', status: 'completed', output: [{ type: 'function_call' }] } });
 history.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'input', transcript: 'Check stock' });
 history.receive({ type: 'response.created', response: { id: 'answer' } });
 history.receive({ type: 'output_audio_buffer.started', response_id: 'answer' });
 history.receive({ type: 'response.done', response: { id: 'answer', status: 'completed', output: [{ role: 'assistant', content: [{ type: 'output_audio', transcript: 'Stock checked.' }] }] } });
 history.receive({ type: 'output_audio_buffer.stopped', response_id: 'answer' });
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
 history.receive({ type: 'input_audio_buffer.committed', item_id: 'second' });
 resolveRead({ source: 'fixture' });
 assert.deepEqual(await pending, { stale: true });
 await history.close();
 assert.deepEqual(steps, [[1, 'start'], [1, 'interrupted'], [2, 'start'], [2, 'unfinished']]);
});
