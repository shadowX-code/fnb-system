import test from 'node:test';import assert from 'node:assert/strict';
import {connectVoice,cleanupVoice,hashTicket,newTicket,hangup} from './voiceConnection.js';
const request=()=>new Request('https://fixture/?voice=webrtc',{method:'POST',body:'v=0\nfixture SDP'});
const lease={actor:'fixture-user',request_id:'fixture-lease',config:{voice:'cedar',tools:[],instructions:'fixture'}};
const entry={credential:'server-only-fixture',revision:1,active_voice:'cedar',approval_reference:'fixture'};
test('SDK WebRTC gateway binds the exact provider call once; no client provider credential',async()=>{
 const token=newTicket();assert.match(token,/^ek_fx_[a-f0-9]{64}$/);const actions=[];let calls=0;
 const result=await connectVoice(request(),token,{registry:async()=>entry,connection:async(a,p)=>{actions.push(a);if(a==='claim'){assert.equal(p.hash,await hashTicket(token));return lease;}assert.equal(p.call_id,'rtc_fixture');assert.equal(p.provider_revision,1);return{state:'active'};},transport:async(url,init)=>{calls++;assert.equal(url,'https://api.openai.com/v1/realtime/calls');assert.equal(init.headers.Authorization,'Bearer '+entry.credential);return new Response('v=0\nanswer',{status:201,headers:{Location:'/v1/realtime/calls/rtc_fixture'}});}});
 assert.deepEqual(actions,['claim','bind']);assert.equal(calls,1);assert.equal(result.call_id,'rtc_fixture');assert.ok(!JSON.stringify(result).includes(entry.credential));
});
test('malformed offers/tickets and replayed claims cannot call OpenAI',async()=>{
 const fail=()=>assert.fail('provider must not run');
 await assert.rejects(connectVoice(request(),'invalid',{connection:fail,registry:fail,transport:fail}),{code:'authentication_required'});
 await assert.rejects(connectVoice(new Request('https://fixture',{method:'POST',body:'bad'}),newTicket(),{connection:fail,registry:fail,transport:fail}),{code:'invalid_request'});
 await assert.rejects(connectVoice(request(),newTicket(),{connection:async()=>{throw Error('already claimed');},registry:fail,transport:fail}),/already claimed/);
});
test('revocation during binding hangs up the created call instead of returning its SDP',async()=>{
 const urls=[];await assert.rejects(connectVoice(request(),newTicket(),{registry:async()=>entry,connection:async a=>a==='claim'?lease:{state:'closing'},transport:async url=>{urls.push(url);return url.endsWith('/hangup')?new Response(null,{status:200}):new Response('v=0\nanswer',{headers:{Location:'/v1/realtime/calls/rtc_fixture'}});}}),{code:'voice_session_expired'});
 assert.equal(urls.length,2);assert.match(urls[1],/rtc_fixture\/hangup$/);
});
test('provider billing rejection is actionable, sanitized and not retried',async()=>{
 let count=0;await assert.rejects(connectVoice(request(),newTicket(),{registry:async()=>entry,connection:async a=>a==='claim'?lease:{},transport:async()=>{count++;return Response.json({error:{code:'insufficient_quota',type:'invalid_request_error',message:'sensitive fixture'}},{status:429,headers:{'retry-after':'12'}});}}),e=>{assert.equal(e.code,'provider_quota_exhausted');assert.equal(e.diagnostic.retry_after_seconds,12);assert.ok(!JSON.stringify(e).includes('sensitive fixture'));return true;});assert.equal(count,1);
});
test('cleanup only hangs up stored call IDs, reports outcome, and never creates a session',async()=>{
 const actions=[];let calls=0;const result=await cleanupVoice('a'.repeat(64),{connection:async(a,p)=>{actions.push(a);if(a==='cleanup')return[{...lease,call_id:'rtc_fixture',credential:entry.credential}];assert.equal(p.status,503);return{};},transport:async(url)=>{calls++;assert.match(url,/\/rtc_fixture\/hangup$/);return new Response(null,{status:503});}});
 assert.deepEqual(result,{processed:1});assert.equal(calls,1);assert.deepEqual(actions,['cleanup','terminated']);
 await assert.rejects(hangup('../../other',entry.credential,()=>assert.fail('SSRF')),{code:'realtime_unavailable'});
});
