import test from 'node:test';import assert from 'node:assert/strict';import {validateBody,dispatch} from './handler.js';
test('usage management accepts only bounded non-secret intents',()=>{
 for(const body of [{action:'voice_usage',actor:'foreign'},{action:'voice_policy_save',revision:1,budget_cents:-1,daily_sessions:3},{action:'voice_allowance_request',cents:10001,reason:'testing'},{action:'voice_allowance_review',id:'bad',decision:'approved'},{action:'voice_usage_report',request_id:'10000000-0000-4000-8000-000000000001',input_audio_tokens:-1,output_audio_tokens:0,duration_ms:0}])assert.throws(()=>validateBody(body));
});
test('usage reads/approval requests do not call a provider or reserve a live evaluation',async()=>{
 const calls=[];const result=await dispatch({action:'voice_usage'},{voiceUsage:async(a,p)=>{calls.push(a);return{remaining:0};},transport:()=>{throw Error('paid request');},reserveRealtime:()=>{throw Error('reservation');}});
 assert.deepEqual(result,{remaining:0});assert.deepEqual(calls,['get']);
});
