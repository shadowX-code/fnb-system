import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeMappingBatch, mappingModel } from './provider.js';

const batch={
  targets:[{row_number:1,account_key:'private-account-id',evidence_key:'private-hash',source_type:'CL',
    source_scope:'current_liability',description:'LOAN - Private Counterparty',parent_description:'Current liabilities',
    candidate_ids:['liabilities.current_borrowings'],rule_id:null,memory_conflict:false}],
  categories:{'liabilities.current_borrowings':'Current borrowings'},
};
const response=(results)=>new Response(JSON.stringify({status:'completed',usage:{input_tokens:15,output_tokens:9,input_tokens_details:{cached_tokens:0}},
  output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(results)}]}]}));

test('bounds provider inputs to evidence, registered choices, and measured usage', async ()=>{
  const outcome=await analyzeMappingBatch(batch,'core','fixture-key',async(url,request)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    const payload=JSON.parse(request.body);
    assert.equal(payload.model,mappingModel);
    assert.equal(payload.store,false);
    assert.equal(request.redirect,'error');
    assert(!request.body.includes('private-account-id') && !request.body.includes('Private Counterparty') && !request.body.includes('private-hash'));
    assert(request.body.includes('LOAN - [counterparty omitted]'));
    return response({results:[{row:1,classificationId:'liabilities.current_borrowings',basis:'source_support'}]});
  });
  assert.equal(outcome.results[0].classificationId,'liabilities.current_borrowings');
  assert.deepEqual(outcome.usage,{input:15,output:9,cached:0});
});

test('does not invent token usage or suggestions for provider errors', async ()=>{
  assert.deepEqual(await analyzeMappingBatch(batch,'core','fixture',async()=>new Response(null,{status:429})),{error:'provider_rate_limited'});
  assert.equal((await analyzeMappingBatch(batch,'core','fixture',async()=>response({wrong:true}))).error,'provider_invalid');
});
