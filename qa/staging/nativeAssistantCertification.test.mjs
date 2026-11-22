import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertScenarioContracts,certifyRun,certifyScenario,generateSourceCases,certifyGeneratedRun} from './nativeAssistantCertification.mjs';
import {moduleCoverage} from '../../scripts/assistantBusinessMatrix.mjs';

test('certification scenarios stay bound to implemented READ contracts',()=>assertScenarioContracts());

test('every canonical module has reviewed coverage and only registered operations',()=>{
 const modules=moduleCoverage();
 assert.equal(modules.find(row=>row.module.id==='space_station').coverage,'not_applicable');
 assert.equal(modules.find(row=>row.module.id==='asset_tracking').direct[0].id,'read_asset_catalogue');
 for(const {coverage,direct,shared} of modules){
  assert.equal(coverage==='partial',direct.length>0);
  if(coverage==='shared')assert(shared.length>0);
 }
});

const rank={
 turn:{request_id:'fixture',created_at:'2026-11-17T00:00:00Z',model:'fixture',state:'completed',tool_state:'completed',
  reply:'1. SKU: A-1 at 61 kg\n2. SKU: A-2 at 42 kg\n3. SKU: A-3 at 11 kg',
  evidence:{capability:'read_factory_finished_goods',ranking:{status:'ranked',unit:'kg',order:'balance_desc',ranked_count:6},
   rows:[{product_code:'A-1',current_balance:61},{product_code:'A-2',current_balance:42},{product_code:'A-3',current_balance:11}]}},
 source:{unit:'kg',order:'balance_desc',count:6,top:[['A-1',61],['A-2',42],['A-3',11]]},
};
test('a saved rank answer must pair exact SKUs, amounts, units and ordering',()=>{
 assert.equal(certifyScenario('fg_rank',rank).status,'PASS');
 for(const reply of [
  'A-1 at 611 kg, A-2 at 42 kg and A-3 at 11 kg',
  'A-1 at 61 packs, A-2 at 42 kg and A-3 at 11 kg',
  'A-2 at 42 kg, A-1 at 61 kg and A-3 at 11 kg',
  'Ranked six results from source.',
 ])assert.equal(certifyScenario('fg_rank',{...rank,turn:{...rank.turn,reply}}).status,'FAIL');
 assert.equal(certifyScenario('rm_rank',rank).status,'FAIL');
});

test('unknown data and policy blocks cannot become passing scenario evidence',()=>{
 assert.equal(certifyRun({}).finance_partial.status,'BLOCKED');
 assert.deepEqual(certifyScenario('restaurant_list',{blocker:'AI access disabled'}),{status:'BLOCKED',reason:'AI access disabled'});
 assert.equal(certifyScenario('fg_rank',{...rank,source:null}).status,'FAIL');
 assert.equal(certifyScenario('fg_rank',{...rank,turn:{...rank.turn,voice_lease_id:'fixture'}}).status,'FAIL');
});

test('asset answer must match the authorized outlet and saved canonical quantity',()=>{
 const source={outletId:'outlet-1',outlet:'Fixture Corner',code:null,name:'Spoon',quantity:72,unit:'unit'};
 const evidence={capability:'read_asset_catalogue',source:'/operations/asset-tracking',requested_scope:{mode:'detail'},
  outlet:{id:source.outletId},match_status:'matched',rows:[{outlet_id:source.outletId,name:'Spoon',asset_code:null,current_quantity:72,unit:'unit'}]};
 const turn={...rank.turn,evidence,reply:'Fixture Corner has 72 kilograms of Spoon.'};
 assert.equal(certifyScenario('asset_spoon',{turn,source}).status,'FAIL');
 assert.equal(certifyScenario('asset_spoon',{turn:{...turn,reply:'Fixture Corner has 72 units of Spoon.'},source}).status,'PASS');
 assert.equal(certifyScenario('asset_spoon',{turn:{...turn,reply:'The current balance of spoons at Fixture Corner is 72 units.'},source}).status,'PASS');
 assert.equal(certifyScenario('asset_spoon',{turn:{...turn,reply:'Fixture Corner has 72 units of Spoon, asset code: asset-spoon.'},source}).status,'FAIL');
 assert.equal(certifyScenario('asset_spoon',{turn:{...turn,reply:'Other Corner has 72 units of Spoon.'},source}).status,'FAIL');
});

test('source-derived cases carry independent expected scope and require the same thread for follow-ups',()=>{
 const source={outletId:'outlet-1',outlet:'Fixture Corner',name:'Fork',code:null,quantity:4,unit:'unit',outletAssetCount:9};
 const cases=generateSourceCases({assets:[source],inventory:[
  {outletId:'outlet-1',outlet:'Fixture Corner',count:9},{outletId:'outlet-2',outlet:'Other Corner',count:3},
 ]});
 assert.equal(cases.length,7);
 assert.equal(cases[3].after,2);
 assert.deepEqual(cases.at(-1).source.counts,{'outlet-1':9,'outlet-2':3});
 assert.match(cases.at(-1).question,/Fixture Corner, Other Corner/);
 const asset={...rank.turn,session_id:'same',reply:'Fixture Corner has 4 units of Fork.',
  evidence:{capability:'read_asset_catalogue',source:'/operations/asset-tracking',requested_scope:{mode:'detail'},
   outlet:{id:source.outletId},match_status:'matched',rows:[{outlet_id:source.outletId,name:'Fork',asset_code:null,current_quantity:4,unit:'unit'}]}};
 const follow={...rank.turn,session_id:'different',created_at:'2026-11-17T00:01:00Z',reply:'Fixture Corner has 9 current asset records.',
  evidence:{capability:'read_asset_catalogue',outlet:{id:source.outletId},requested_scope:{mode:'summary'},aggregate_complete:true,total_matching:9,rows:[]}};
 cases[2].turn=asset;
 cases[3].turn=follow;
 assert.equal(certifyGeneratedRun(cases)[3].status,'FAIL');
 follow.session_id='same';
 assert.equal(certifyGeneratedRun(cases)[3].status,'PASS');
 assert.equal(certifyGeneratedRun(cases)[0].status,'BLOCKED');
});
