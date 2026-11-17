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
  const business=createBusinessDispatcher({config:{capability_connections:{read_factory_finished_goods:enabled}},access:{factory:authorized},readFactory});
  assert.equal(business.capabilities.find(o=>o.id==='read_factory_finished_goods').availability,status);
  assert.equal(business.capabilities.find(o=>o.id==='read_factory_finished_goods').module_id,'factory_finished_goods');
  assert.equal(business.tools.length,status==='connected'?1:0);
  if(status!=='connected')await assert.rejects(business.execute(finishedGoodsRead.id,args),{code:enabled?'factory_read_denied':'capability_disconnected'});
  else {assert.deepEqual(business.tools,[finishedGoodsRead.tool]);await business.execute(finishedGoodsRead.id,args);}
  for(const name of ['create_factory_job_order','arbitrary_sql','__proto__'])await assert.rejects(business.execute(name,args),{code:'tool_not_allowed'});
 }
 assert.equal(reads,1);
});
test('Voice name dispatch and legacy fixed-name compatibility reserve once and attach the unchanged evidence',async()=>{
 for(const operation of [undefined,finishedGoodsRead.id]){
  let reads=0,reservations=0;const evidence={capability:finishedGoodsRead.id,scope:'fixture',as_of:'fixture',rows:[]};
  const result=await dispatch({action:'realtime_tool',provider:'openai',session_id:id,request_id:id,turn_id:id,arguments:args,...operation?{operation}:{}},{
   rpc:async()=>({config:{enabled:true,capability_connections:{read_factory_finished_goods:true}}}),get:()=>undefined,access:{factory:true},
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
 assert.equal(businessCapabilities({capability_connections:{read_factory_finished_goods:true}},{factory:true}).filter(x=>x.kind==='ACTION'&&x.availability==='connected').length,0);
});
test('settings test cannot bypass disconnected state or human authority',async()=>{
 let reads=0;const context={rpc:async()=>({config:{capability_connections:{read_factory_finished_goods:false}},can_edit:true}),get:()=>undefined,access:{factory:true},readFactory:async()=>{reads++;}};
 const body={action:'capability_test',operation:finishedGoodsRead.id};
 await assert.rejects(dispatch(body,context),{code:'capability_disconnected'});assert.equal(reads,0);
 await assert.rejects(dispatch(body,{...context,rpc:async()=>({config:{},can_edit:false})}),{code:'settings_edit_required'});
 await assert.rejects(dispatch(body,{...context,access:{factory:false},rpc:async()=>({config:{capability_connections:{read_factory_finished_goods:true}},can_edit:true})}),{code:'factory_read_denied'});assert.equal(reads,0);
});
test('disconnect after discovery prevents a later model tool execution',async()=>{
 let reads=0;const business=createBusinessDispatcher({config:{capability_connections:{read_factory_finished_goods:true}},access:{factory:true},loadConfig:async()=>({capability_connections:{read_factory_finished_goods:false}}),readFactory:async()=>reads++});
 assert.equal(business.tools.length,1);await assert.rejects(business.execute(finishedGoodsRead.id,args),{code:'capability_disconnected'});assert.equal(reads,0);
});
test('connection changes accept only registered operations and settings editors',async()=>{
 const body={action:'capability_connection',operation:finishedGoodsRead.id,enabled:false,expected_revision:4};
 for(const operation of ['__proto__','create_factory_job_order','unknown'])assert.throws(()=>validateBody({...body,operation}),{code:'tool_not_allowed'});
 assert.throws(()=>validateBody({...body,enabled:'true'}),{code:'configuration_invalid'});
 assert.throws(()=>validateBody({...body,confirmed:true}));
 await assert.rejects(dispatch(body,{rpc:async()=>({config:{},can_edit:false}),get:()=>undefined}),{code:'settings_edit_required'});
 const calls=[];await dispatch(body,{rpc:async(action,payload)=>{calls.push([action,payload]);return {config:{},can_edit:true};},get:()=>undefined});
 assert.deepEqual(calls.at(-1),['capability_connection',{operation:body.operation,enabled:false,expected_revision:4}]);
});
