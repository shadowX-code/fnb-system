import {test} from 'node:test';import assert from 'node:assert/strict';
import {connection,publicRuntime,generateText} from './provider.js';import {dispatch,validateBody} from './handler.js';
const config={provider:'openai',model:'gpt-4o-mini',credential_ref:'native-assistant-openai',enabled:true,provider_revision:1};
const env={NATIVE_ASSISTANT_OPENAI_API_KEY:'fixture-key-not-real',NATIVE_ASSISTANT_APPROVED_USE:'native-assistant-phase1a',NATIVE_ASSISTANT_APPROVAL_REFERENCE:'fixture-approval',NATIVE_ASSISTANT_MODELS:'gpt-4o-mini'};const get=k=>env[k];
const response=text=>new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:20,output_tokens:5}}));
const claim={kind:'turn',model:config.model,prompt:'Which one?',context:[{prompt:'Remember mint',reply:'Mint noted.'}]};
test('dedicated approval and key required; never domain fallback; public metadata has no secret',()=>{assert.equal(connection(config,k=>k==='OPENAI_API_KEY'?'unrelated':undefined).blocker,'provider_not_authorized');assert.equal(connection(config,k=>k==='NATIVE_ASSISTANT_OPENAI_API_KEY'?undefined:get(k)).blocker,'provider_credential_missing');assert.equal(connection({...config,model:'gpt-4.1-mini'},get).blocker,'model_not_authorized');assert(!JSON.stringify(publicRuntime(config,get)).includes(env.NATIVE_ASSISTANT_OPENAI_API_KEY));});
test('bounded real transport contract carries context, no tools and no provider persistence (fixture)',async()=>{let sent;const r=await generateText(claim,env.NATIVE_ASSISTANT_OPENAI_API_KEY,{transport:async(url,opts)=>{assert.equal(url,'https://api.openai.com/v1/responses');sent=JSON.parse(opts.body);return response('Mint.');}});assert.equal(r.reply,'Mint.');assert.equal(sent.input.length,3);assert.equal(sent.store,false);assert.equal(sent.max_output_tokens,500);assert(!sent.tools);});
test('rejects tools, incomplete, credential echo and oversized provider output',async()=>{for(const data of [{status:'completed',output:[{type:'function_call'}]},{status:'incomplete',output:[]},{status:'completed',output:[{type:'message',content:[{type:'output_text',text:env.NATIVE_ASSISTANT_OPENAI_API_KEY}]}]}])await assert.rejects(generateText(claim,env.NATIVE_ASSISTANT_OPENAI_API_KEY,{transport:async()=>new Response(JSON.stringify(data))}));await assert.rejects(generateText(claim,'key',{transport:async()=>new Response('x'.repeat(140000))}),{code:'provider_response_limit'});});
test('cancellation and provider errors are sanitized',async()=>{const c=new AbortController();c.abort();await assert.rejects(generateText(claim,'key',{signal:c.signal,transport:async(_,o)=>{o.signal.throwIfAborted();}}),{code:'cancelled'});await assert.rejects(generateText(claim,'key',{transport:async()=>new Response('secret provider detail',{status:429})}),{code:'provider_rate_limited'});});
test('fixed schemas reject arbitrary actor, tools, credential and endpoint selection',()=>{for(const b of [{action:'finish'},{action:'status',actor:'x'},{action:'configuration',credential:'x'},{action:'begin',text:'x',session_id:'invalid',request_id:'invalid'},{action:'configure',provider:'openai',model:'anything'}])assert.throws(()=>validateBody(b));});
test('unconfigured connection test persists unavailability without calling model; enable/begin fail closed',async()=>{const calls=[];const deps={get:()=>undefined,rpc:async(a,p)=>{calls.push([a,p]);return {config};},transport:()=>{throw new Error('must not call');}};const r=await dispatch({action:'test',request_id:'10000000-0000-4000-8000-000000000001'},deps);assert.equal(r.outcome,'unavailable');assert.equal(calls[1][0],'test_record');await assert.rejects(dispatch({action:'begin',session_id:'10000000-0000-4000-8000-000000000002',request_id:'10000000-0000-4000-8000-000000000001',text:'hello'},deps),{code:'provider_not_authorized'});});
test('one claimed request calls transport once; replays do not regenerate (fixture)',async()=>{let n=0;let running=false;const rpc=async a=>a==='status'?{config}:a==='claim'?(running?{state:'running'}:(running=true,{...claim,state:'running',lease_id:'lease',turn_id:'id'})):{state:'completed',reply:'Mint.'};const b={action:'respond',session_id:'10000000-0000-4000-8000-000000000002',turn_id:'10000000-0000-4000-8000-000000000001'};await dispatch(b,{rpc,get,transport:async()=>{n++;return response('Mint.');}});await dispatch(b,{rpc,get,transport:async()=>{n++;return response('Mint.');}});assert.equal(n,1);});
test('late cancelled finish cannot produce a result (fixture)',async()=>{const rpc=async a=>a==='status'?{config}:a==='claim'?{...claim,state:'running',lease_id:'lease'}:Promise.reject(new Error('turn_no_longer_active'));await assert.rejects(dispatch({action:'respond',session_id:'10000000-0000-4000-8000-000000000002',turn_id:'10000000-0000-4000-8000-000000000001'},{rpc,get,transport:async()=>response('late')}));});

test('replayed test never manufactures a fresh verified outcome (fixture)',async()=>{await assert.rejects(dispatch({action:'test',request_id:'10000000-0000-4000-8000-000000000001'},{get,rpc:async a=>a==='configuration'?{config}:{replayed:true,state:'completed'},transport:()=>{throw Error('must not regenerate');}}),{code:'test_already_requested'});});

test('provider rejection classification never returns raw messages or unrecognized codes',async()=>{
 for(const [status,code,expected] of [[401,'invalid_api_key','provider_credential_invalid'],[403,'insufficient_permissions','provider_permission_denied'],[404,'model_not_found','provider_model_unavailable'],[429,'insufficient_quota','provider_quota_exhausted'],[429,'project_spend_limit_exceeded','provider_budget_exhausted'],[400,'untrusted-secret-code','provider_rejected']]){
  await assert.rejects(generateText(claim,'fixture-key',{transport:async()=>new Response(JSON.stringify({error:{code,message:'secret raw provider details'}}),{status})}),e=>e.code===expected&&!e.message.includes('secret'));
 }
});
test('oversized error bodies are discarded and fall back to sanitized HTTP classification',async()=>{
 await assert.rejects(generateText(claim,'fixture-key',{transport:async()=>new Response('secret'.repeat(4000),{status:403})}),{code:'provider_permission_denied'});
});
test('401 missing Responses scope is permission denial, not invalid key; diagnostics contain no raw message',async()=>{
 const body={error:{code:null,type:'invalid_request_error',message:'You have insufficient permissions. Missing scopes: api.responses.write. secret fixture-key-do-not-leak'}};
 await assert.rejects(generateText(claim,'fixture-key-do-not-leak',{transport:async()=>new Response(JSON.stringify(body),{status:401})}),e=>{
  assert.equal(e.code,'provider_permission_denied');assert.deepEqual(e.diagnostic,{source:'openai',http_status:401,provider_error_code:null,provider_error_type:'invalid_request_error',endpoint:'https://api.openai.com/v1/responses',model:'gpt-4o-mini',missing_permissions:['api.responses.write']});
  assert(!JSON.stringify(e.diagnostic).includes('fixture-key'));assert(!JSON.stringify(e.diagnostic).includes('You have'));return true;
 });
});
test('bare 401 never confirms invalid_api_key; unknown upstream identifiers are redacted',async()=>{
 await assert.rejects(generateText(claim,'fixture-key',{transport:async()=>new Response(JSON.stringify({error:{code:null,type:'authentication_error',message:'private details'}}),{status:401})}),e=>e.code==='provider_authentication_rejected'&&e.diagnostic.provider_error_code===null);
 await assert.rejects(generateText(claim,'fixture-key',{transport:async()=>new Response(JSON.stringify({error:{code:'secret_value',type:'secret_type',message:'private details'}}),{status:400})}),e=>e.code==='provider_rejected'&&e.diagnostic.provider_error_code==='unrecognized_redacted'&&e.diagnostic.provider_error_type==='unrecognized_redacted');
});
test('local malformed credential fails before upstream and uses distinct format error',async()=>{
 assert.equal(connection(config,k=>k==='NATIVE_ASSISTANT_OPENAI_API_KEY'?'fixture\nkey':get(k)).blocker,'provider_credential_format_invalid');
 const actions=[];const r=await dispatch({action:'test',request_id:'10000000-0000-4000-8000-000000000001'},{get:k=>k==='NATIVE_ASSISTANT_OPENAI_API_KEY'?'fixture\nkey':get(k),rpc:async a=>{actions.push(a);return {config};},transport:()=>{throw Error('upstream must not be called');}});
 assert.equal(r.outcome,'unavailable');assert.equal(r.code,'provider_credential_format_invalid');assert(!actions.includes('test_begin'));
});

test('missing permission identifiers match exact scopes without overlapping suffixes',async()=>{await assert.rejects(generateText(claim,'fixture-key',{transport:async()=>new Response(JSON.stringify({error:{code:null,type:'invalid_request_error',message:'Missing scopes: api.model.request. Check your role.'}}),{status:401})}),e=>JSON.stringify(e.diagnostic.missing_permissions)===JSON.stringify(['api.model.request']));});


test('voice outcome diagnostics accept only a fixed reason, never arbitrary provider payloads',()=>{
 const id='249ec7e0-df75-4145-8a34-ec2baf82f9ef';
 const turn={action:'realtime_turn',session_id:id,request_id:id,turn_id:id,provider:'openai',step:'unfinished',text:'actual partial'};
 assert.doesNotThrow(()=>validateBody({...turn,details:{reason:'max_output_tokens'}}));
 for(const details of [{reason:'raw-sensitive-provider-message'},{reason:'provider_failed',payload:'private'},[],null])assert.throws(()=>validateBody({...turn,details}),{code:'invalid_request'});
});
