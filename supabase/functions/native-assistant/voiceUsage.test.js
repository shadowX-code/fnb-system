import test from 'node:test';import assert from 'node:assert/strict';import {validateBody,dispatch} from './handler.js';
test('usage management accepts only bounded non-secret intents',()=>{
 for(const body of [{action:'voice_usage',actor:'foreign'},{action:'voice_policy_save',revision:1,budget_cents:-1,daily_sessions:3},{action:'voice_allowance_request',cents:10001,reason:'testing'},{action:'voice_allowance_review',id:'bad',decision:'approved'},{action:'voice_usage_report',request_id:'10000000-0000-4000-8000-000000000001',input_audio_tokens:-1,output_audio_tokens:0,duration_ms:0}])assert.throws(()=>validateBody(body));
});
test('usage reads/approval requests do not call a provider or reserve a live evaluation',async()=>{
 const calls=[];const result=await dispatch({action:'voice_usage'},{voiceUsage:async(a,p)=>{calls.push(a);return{remaining:0};},transport:()=>{throw Error('paid request');},reserveRealtime:()=>{throw Error('reservation');}});
 assert.deepEqual(result,{remaining:0});assert.deepEqual(calls,['get']);
});

const exampleUsage={
 input_tokens:11,output_tokens:11,
 input_token_details:{text_tokens:4,audio_tokens:6,image_tokens:1,cached_tokens:4,cached_tokens_details:{text_tokens:2,audio_tokens:2}},
 output_token_details:{text_tokens:3,audio_tokens:8},
};

test('deduplicates billable terminal responses and preserves independent transcription duration',async()=>{
 const {createVoiceMetering}=await import('../_shared/assistant/voiceMetering.js');
 const {priceVoiceMetering}=await import('./voicePricing.js');
 const meter=createVoiceMetering();
 meter.receive({type:'session.created',session:{model:'gpt-realtime-2.1-mini'}});
 meter.receive({type:'input_audio_buffer.committed',item_id:'item_1'});
 const done={type:'response.done',response:{id:'resp_1',status:'cancelled',usage:exampleUsage,output:[{text:'private'}]}};
 meter.receive({type:'response.created',response:{id:'resp_1'}});
 meter.receive(done);
 meter.receive(done);
 meter.receive({type:'conversation.item.input_audio_transcription.completed',item_id:'item_1',transcript:'private',usage:{type:'duration',seconds:2.5}});
 const snapshot=meter.snapshot(true);
 assert.equal(snapshot.responses.length,1);
 assert.equal(JSON.stringify(snapshot).includes('private'),false);
 const price=priceVoiceMetering(snapshot,'gpt-realtime-2.1-mini','gpt-transcribe');
 assert.equal(price.charge_status,'estimated');
 assert.equal(price.estimated_cost_nano_usd,397420);
 assert.equal(price.input_audio_tokens,6);
 assert.equal(price.priced_transcriptions,1);
 meter.receive({type:'response.created',response:{id:'resp_pending'}});
 assert.equal(priceVoiceMetering(meter.snapshot(true),'gpt-realtime-2.1-mini','gpt-transcribe').charge_status,'partial');
 assert.equal(priceVoiceMetering(snapshot,'unknown','unknown').charge_status,'unavailable');
});

test('missing cache attribution never becomes an uncached estimate and reporting cannot supply a price',async()=>{
 const {createVoiceMetering}=await import('../_shared/assistant/voiceMetering.js');
 const meter=createVoiceMetering();
 meter.receive({type:'response.done',response:{id:'resp_1',usage:{...exampleUsage,input_token_details:{...exampleUsage.input_token_details,cached_tokens_details:undefined}}}});
 const body={action:'voice_usage_report',request_id:'10000000-0000-4000-8000-000000000001',input_audio_tokens:6,output_audio_tokens:8,duration_ms:4000,metering:meter.snapshot(true)};
 const result=await dispatch(body,{voiceUsage:async(action,payload)=>{
  assert.equal(action,'report_metering');
  return payload.metering;
 },transport:()=>{throw Error('paid request');}});
 assert.equal(result.charge_status,'unavailable');
 assert.equal(result.estimated_cost_nano_usd,null);
 assert.throws(()=>validateBody({...body,estimated_cost_nano_usd:42}));
 assert.throws(()=>validateBody({action:'voice_usage',period:'arbitrary',status:'all',page:1}));
 assert.throws(()=>validateBody({action:'voice_usage',page:0}));
});
