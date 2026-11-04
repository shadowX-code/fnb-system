import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryContext,recentContext} from './context.js';
import {dispatch,validateBody} from './handler.js';
test('memory is opt-in and cannot contain raw preferences or operational data',()=>{
 assert.equal(memoryContext({enabled:false,language:'mandarin'}),'');
 assert.match(memoryContext({enabled:true,language:'mixed',reply_style:'steps'}),/Malaysian mixed-language; Step by step/);
 assert.equal(memoryContext({enabled:true,language:'not allowlisted'}),'');
 assert.throws(()=>validateBody({action:'memory_save',enabled:true,language:'api-key',reply_style:null,work_preference:null}),{code:'memory_invalid'});
 assert.throws(()=>validateBody({action:'memory_get',user_id:'other'}),{code:'invalid_request'});
});
test('context excludes unknown transcripts and historical stock answers',()=>{
 assert.deepEqual(recentContext([{prompt:'Voice transcript unavailable',reply:'skip'},{prompt:'Check stock',has_evidence:true,reply:'old stock count'},{prompt:'hello',reply:'good morning'}]),
 [{prompt:'Check stock',reply:'[Historical inventory answer omitted. Read current authorized evidence again.]'},{prompt:'hello',reply:'good morning'}]);
});
test('history and memory load without provider state or credentials',async()=>{
 const rpc=async(action,args)=>({action,args});
 assert.deepEqual(await dispatch({action:'memory_get'},{rpc}),{action:'memory_get',args:{}});
 assert.deepEqual(await dispatch({action:'session_list',query:'planning'},{rpc}),{action:'session_list',args:{query:'planning'}});
 assert.throws(()=>validateBody({action:'session_list',before_id:'10000000-0000-4000-8000-000000000001'}),{code:'invalid_request'});
});
