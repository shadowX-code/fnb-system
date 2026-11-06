import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleContext,estimateTokens,explicitRecallQuery,contextInstructions} from './conversationContext.js';
const rows=Array.from({length:60},(_,i)=>({seq:i+1,prompt:i===0?'We decided to use the green menu. Reference https://example.com/menu':'Discuss the next menu. '.repeat(85),reply:'Pending: confirm the menu with the team. '.repeat(70)}));
test('long multilingual history is bounded; originals are untouched; no model summarizer',()=>{
 const input=structuredClone(rows);input[20]={seq:21,prompt:'检查库存',reply:'secret stale 42',has_evidence:true};
 const before=JSON.stringify(input);const out=assembleContext({context:input,fingerprint:'revision-1'});
 assert.ok(out.stats.estimated_context_tokens<=8000);assert.equal(out.stats.source_turns,60);
 assert.equal(out.summary.version,'extractive-v1');assert.match(out.notes,/green menu/);assert.doesNotMatch(out.notes,/secret stale/);
 assert.match(contextInstructions(out),/authorized fresh read/);assert.equal(JSON.stringify(input),before);
 assert.ok(estimateTokens('中文中文')>estimateTokens('abcd'));
});
test('short threads do not summarize; cached summaries require exact source fingerprint/version',()=>{
 assert.equal(assembleContext({context:rows.slice(0,2)}).summary,null);
 const fresh=assembleContext({context:rows,fingerprint:'a'});
 const cache={...fresh.summary,text:'Verified cache marker'};
 assert.match(assembleContext({context:rows,fingerprint:'a',summary:cache}).notes,/Verified cache marker/);
 assert.doesNotMatch(assembleContext({context:rows,fingerprint:'b',summary:cache}).notes,/Verified cache marker/);
 assert.doesNotMatch(assembleContext({context:rows,fingerprint:'a',summary:{...cache,version:'old'}}).notes,/Verified cache marker/);
});
test('cross-thread recall is explicit, bounded and source identified',()=>{
 assert.equal(explicitRecallQuery('What is our stock?'),null);
 assert.equal(explicitRecallQuery('What did we decide?'),null);
 assert.match(explicitRecallQuery('Recall our previous conversation about green menu'),/green menu/);
 const recalled=Array.from({length:8},(_,i)=>({session_id:'owned'+i,title:'Menu',seq:i,prompt:'menu '.repeat(600)}));
 const out=assembleContext({context:rows},recalled);
 assert.ok(out.stats.estimated_context_tokens<=8000);assert.match(out.notes,/Explicit recall/);
});
test('usage estimates require actual known tokens and an explicit rate version',async()=>{
 const {estimatedTextCost}=await import('./conversationContext.js');
 assert.equal(estimatedTextCost('gpt-4o-mini',{input_tokens:1000,output_tokens:1000}).estimated_usd,.00075);
 assert.equal(estimatedTextCost('gpt-4o-mini',{input_tokens:null,output_tokens:3}).estimated_usd,null);
 assert.equal(estimatedTextCost('voice',{input_tokens:1,output_tokens:1}).estimated_usd,null);
});
test('escaped, CJK and emoji history cannot exceed the estimated budget',()=>{
 const input=Array.from({length:60},(_,i)=>({seq:i,prompt:'"\\中文👋'.repeat(300),reply:'"\\中文👋'.repeat(400)}));
 const sources=[{session_id:'owned',title:'中文'.repeat(40),seq:1,prompt:'"\\中文'.repeat(200)}];
 assert.ok(assembleContext({context:input},sources).stats.estimated_context_tokens<=8000);
});
