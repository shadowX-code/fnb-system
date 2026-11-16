import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessDispatcher,businessCapabilities} from './business.js';
import {finishedGoodsRead} from '../_shared/factory/finishedGoodsRead.js';
import {dispatch,validateBody} from './handler.js';
const id='249ec7e0-df75-4145-8a34-ec2baf82f9ef';
const args={query:'',availability:'all'};
test('discovery, model schemas and execution share the module contract; disabled and unknown actions cannot run',async()=>{
 let reads=0;const readFactory=async()=>{reads++;return {capability:finishedGoodsRead.id};};
 for(const [enabled,authorized,status] of [[false,true,'disabled'],[true,false,'denied'],[true,true,'connected']]){
  const business=createBusinessDispatcher({config:{factory_reads_enabled:enabled},access:{factory:authorized},readFactory});
  assert.equal(business.capabilities[0].availability,status);
  assert.equal(business.capabilities[0].module_id,'factory_finished_goods');
  assert.equal(business.tools.length,status==='connected'?1:0);
  if(status!=='connected')await assert.rejects(business.execute(finishedGoodsRead.id,args),{code:'factory_read_denied'});
  else {assert.deepEqual(business.tools,[finishedGoodsRead.tool]);await business.execute(finishedGoodsRead.id,args);}
  for(const name of ['create_factory_job_order','arbitrary_sql','__proto__'])await assert.rejects(business.execute(name,args),{code:'tool_not_allowed'});
 }
 assert.equal(reads,1);
});
test('Voice name dispatch and legacy fixed-name compatibility reserve once and attach the unchanged evidence',async()=>{
 for(const operation of [undefined,finishedGoodsRead.id]){
  let reads=0,reservations=0;const evidence={capability:finishedGoodsRead.id,scope:'fixture',as_of:'fixture',rows:[]};
  const result=await dispatch({action:'realtime_tool',provider:'openai',session_id:id,request_id:id,turn_id:id,arguments:args,...operation?{operation}:{}},{
   rpc:async()=>({config:{enabled:true,factory_reads_enabled:true}}),get:()=>undefined,access:{factory:true},
   reserveRealtime:async action=>{assert.equal(action,'tool');reservations++;},
   readFactory:async value=>{assert.deepEqual(value,args);reads++;return evidence;},
   voiceHistory:async payload=>{assert.equal(payload.step,'evidence');assert.equal(payload.evidence,evidence);},
  });
  assert.equal(result,evidence);assert.equal(reads,1);assert.equal(reservations,1);
 }
});
test('public intents cannot supply action authority, confirmation, a caller or arbitrary operation',()=>{
 const base={action:'realtime_tool',provider:'openai',session_id:id,request_id:id,arguments:args};
 for(const extra of [{operation:'create_factory_job_order'},{confirmed:true},{actor:id},{diagnostic:true},{ai_execution_authorized:true}])assert.throws(()=>validateBody({...base,...extra}));
 assert.equal(businessCapabilities({factory_reads_enabled:true},{factory:true}).filter(x=>x.kind==='ACTION').length,0);
});
test('settings diagnostic preserves its independent human permission test without enabling reads',async()=>{
 let reads=0;const context={rpc:async()=>({config:{factory_reads_enabled:false},can_edit:true}),get:()=>undefined,access:{factory:false},readFactory:async()=>{reads++;throw Object.assign(new Error('denied'),{code:'factory_read_denied'});}};
 await assert.rejects(dispatch({action:'tool_test'},context),{code:'factory_read_denied'});assert.equal(reads,1);
 await assert.rejects(dispatch({action:'tool_test'},{...context,rpc:async()=>({config:{},can_edit:false})}),{code:'settings_edit_required'});assert.equal(reads,1);
});
