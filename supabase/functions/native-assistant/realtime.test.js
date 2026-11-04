import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from './handler.js';

const id = '249ec7e0-df75-4145-8a34-ec2baf82f9ef';
const request = { action:'realtime_connect', provider:'openai', session_id:id, request_id:id, sdp:'v=0\r\n', voice:'cedar' };
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
  reserveRealtime:async (action, args) => {
   assert.equal(action,'start');
   assert.equal(args.session_id,id);
   assert.equal(args.request_id,id);
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
 assert.equal(result.sdp,'v=0\r\n');
 assert.deepEqual(result.tools,[]);
});

test('Grok receives a separate credential and returns only ephemeral authorization', async () => {
 const { sdp, ...grok } = { ...request, provider: 'grok', voice: 'eve' };
 const result = await dispatch(grok, {
  rpc: async () => ({ config: { enabled:true, factory_reads_enabled:true }, can_edit:true }),
  get: key => ({
   NATIVE_ASSISTANT_GROK_API_KEY:'fixture-long-lived',
   NATIVE_ASSISTANT_GROK_APPROVED_USE:'native-assistant-staging-realtime-evaluation',
   NATIVE_ASSISTANT_GROK_APPROVAL_REFERENCE:'fixture',
  })[key],
  access:{factory:true},
  reserveRealtime:async action => assert.equal(action,'start'),
  transport:async (url, init) => {
   assert.equal(url,'https://api.x.ai/v1/realtime/client_secrets');
   assert.equal(JSON.parse(init.body).expires_after.seconds,60);
   return Response.json({value:'fixture-short-lived',expires_at:Math.floor(Date.now()/1000)+60});
  },
 });
 assert.equal(result.client_secret,'fixture-short-lived');
 assert.equal(result.tools[0].name,'read_factory_finished_goods');
 assert.ok(!JSON.stringify(result).includes('fixture-long-lived'));
});

test('Realtime inventory requires canonical permission and a charged reservation', async () => {
 const { sdp, voice, ...base } = request;
 const tool = { ...base, action:'realtime_tool', arguments:{ query:'Sauce', availability:'low' } };
 const ctx = { rpc:async()=>({config:{enabled:true,factory_reads_enabled:true},can_edit:true}), get:key=>approved[key], reserveRealtime:fail, readTool:fail };
 await assert.rejects(dispatch(tool,ctx),{code:'factory_read_denied'});
 await assert.rejects(dispatch(tool,{...ctx,access:{factory:true},reserveRealtime:async()=>{throw Error('lease denied');}}),/lease denied/);
 const result = await dispatch(tool,{...ctx,access:{factory:true},
  reserveRealtime:async action=>assert.equal(action,'tool'),
  readTool:async args=>({query:args.query,source:'/factory/warehouse/finished-goods'}),
 });
 assert.equal(result.query,'Sauce');
});

test('SDK baseline reserves before minting and never exposes the configured API key', async () => {
 const { sdp, ...requestFields } = request;
 const body = { ...requestFields, action:'realtime_sdk_connect' };
 const ctx = {
  rpc:async()=>({config:{enabled:true},can_edit:true}), get:key=>approved[key],
  transport:async (url,init)=>{
   assert.equal(url,'https://api.openai.com/v1/realtime/client_secrets');
   const payload=JSON.parse(init.body);
   assert.equal(payload.session.model,'gpt-realtime-2.1-mini');
   assert.equal(payload.session.tools,undefined);
   assert.equal(payload.expires_after.seconds,60);
   return Response.json({value:'ek_fixture_token'});
  },
 };
 await assert.rejects(dispatch(body,{...ctx,reserveRealtime:async()=>{throw new Error('quota');},transport:fail}),/quota/);
 const result=await dispatch(body,{...ctx,reserveRealtime:async action=>assert.equal(action,'sdk_baseline')});
 assert.equal(result.client_secret,'ek_fixture_token');
 assert.ok(!JSON.stringify(result).includes(approved.NATIVE_ASSISTANT_REALTIME_API_KEY));
});

test('SDK startup classifies provider rejections without disclosing response text or unsafe metadata', async () => {
 const { createSdkVoiceSecret } = await import('./realtime.js');
 const cases = [
  [429, 'rate_limit_exceeded', 'realtime_rate_limited'],
  [429, 'insufficient_quota', 'provider_quota_exhausted'],
  [429, null, 'realtime_429_unclassified'],
  [401, 'invalid_api_key', 'realtime_permission_denied'],
  [503, 'secret-fixture', 'realtime_provider_temporary'],
 ];
 for (const [status, code, expected] of cases) {
  await assert.rejects(createSdkVoiceSecret('cedar', key=>approved[key], {
   transport:async()=>Response.json({error:{code,message:'private-fixture',type:'secret-fixture'}}, {
    status, headers:{'retry-after':'15','x-request-id':'req_fixture123'},
   }),
  }), error => {
   assert.equal(error.code, expected);
   assert.equal(error.diagnostic.http_status, status);
   assert.equal(error.diagnostic.provider_error_code,code==='secret-fixture'?'unrecognized_redacted':code);
   assert.equal(error.diagnostic.provider_error_type,'unrecognized_redacted');
   assert.equal(error.diagnostic.retry_after_seconds,15);
   assert.equal(error.diagnostic.request_id,'req_fixture123');
   assert.doesNotMatch(JSON.stringify(error.diagnostic),/private-fixture|secret-fixture/);
   return true;
  });
 }
});
