import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from './handler.js';

const id = '249ec7e0-df75-4145-8a34-ec2baf82f9ef';
const request = { action:'realtime_connect', session_id:id, request_id:id, sdp:'v=0\r\n', voice:'cedar' };
const approved = {
 NATIVE_ASSISTANT_REALTIME_API_KEY:'fixture-only',
 NATIVE_ASSISTANT_REALTIME_APPROVED_USE:'native-assistant-staging-realtime-evaluation',
 NATIVE_ASSISTANT_REALTIME_APPROVAL_REFERENCE:'fixture',
};
const fail = () => assert.fail('Must stop before reservation or provider call');
test('Realtime requires separate authorization and settings edit authority', async () => {
 for (const [get, canEdit] of [[() => undefined, true], [key => approved[key], false]]) {
  await assert.rejects(dispatch(request, { rpc:async () => ({ config:{enabled:true}, can_edit:canEdit }), get, reserveRealtime:fail, transport:fail }), { code:'realtime_not_authorized' });
 }
});
test('Realtime reserves before negotiating a fixed tool-free WebRTC session', async () => {
 let reserved = false;
 const result = await dispatch(request, {
  rpc:async () => ({ config:{enabled:true}, can_edit:true }),
  get:key => approved[key],
  reserveRealtime:async (session, requestId) => {
   assert.equal(session,id);
   assert.equal(requestId,id);
   reserved = true;
  },
  transport:async (url, init) => {
   assert.equal(reserved,true);
   assert.equal(url,'https://api.openai.com/v1/realtime/calls');
   const session = JSON.parse(init.body.get('session'));
   assert.equal(session.model,'gpt-realtime-2.1-mini');
   assert.equal(session.audio.input.turn_detection.interrupt_response,true);
   assert.equal(session.audio.output.voice,'cedar');
   assert.equal(session.tools,undefined);
   return new Response('v=0\r\n');
  },
 });
 assert.deepEqual(result,{sdp:'v=0\r\n'});
});
