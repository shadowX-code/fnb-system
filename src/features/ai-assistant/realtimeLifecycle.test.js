import {describe,it,expect,vi} from 'vitest';
import {createRealtimeLifecycle} from './realtimeLifecycle.js';

function fixture() {
 const record=vi.fn(), send=vi.fn(()=>true), trace=vi.fn();
 const readTool=vi.fn(async()=>({scope:'fixture'}));
 const lifecycle=createRealtimeLifecycle({record,send,trace,readTool,state:vi.fn(),preview:vi.fn(),isCurrent:()=>true,provider:'openai'});
 const emit=(type,fields={})=>lifecycle.receive({type,...fields});
 const commit=id=>emit('input_audio_buffer.committed',{item_id:id});
 const created=(id,metadata)=>emit('response.created',{response:{id,metadata}});
 const done=(id,output,status='completed',reason)=>emit('response.done',{response:{id,output,status,status_details:{reason}}});
 const audio=[{type:'message',content:[{type:'audio',transcript:'spoken fixture'}]}];
 return {lifecycle,record,send,trace,readTool,emit,commit,created,done,audio};
}
describe('Realtime response ownership',()=>{
 it('waits for tool acknowledgement, ignores stale drain and completes follow-up audio once',async()=>{
  const {record,send,readTool,emit,commit,created,done,audio}=fixture();
  commit('user1');
  created('tool-response');
  done('tool-response',[{type:'function_call',name:'read_factory_finished_goods',call_id:'call1',arguments:'{}'}]);
  await Promise.resolve();
  expect(readTool).toHaveBeenCalledTimes(1);
  expect(send.mock.calls.map(([e])=>e.type)).toEqual(['conversation.item.create']);
  const item=send.mock.calls[0][0].item;
  emit('conversation.item.added',{item});
  emit('conversation.item.added',{item});
  const continuation=send.mock.calls[1][0];
  expect(send).toHaveBeenCalledTimes(2);
  created('continued',continuation.response.metadata);
  emit('output_audio_buffer.stopped',{response_id:'tool-response'});
  done('continued',audio);
  emit('input_audio_buffer.speech_started');
  expect(record.mock.calls.map(([,step])=>step)).toEqual(['start']);
  emit('output_audio_buffer.stopped',{response_id:'continued'});
  commit('user2');
  created('followup');
  done('followup',audio);
  emit('output_audio_buffer.stopped',{response_id:'followup'});
  expect(record.mock.calls.map(([,step])=>step)).toEqual(['start','complete','start','complete']);
 });
 it('distinguishes provider barge-in, incomplete output and session shutdown',()=>{
  const {lifecycle,record,trace,emit,commit,created,done}=fixture();
  commit('one');created('r1');emit('output_audio_buffer.started',{response_id:'r1'});
  emit('input_audio_buffer.speech_started');
  expect(record.mock.calls.map(([,step])=>step)).toEqual(['start']);
  done('r1',[],'cancelled','turn_detected');
  emit('output_audio_buffer.cleared',{response_id:'r1'});
  commit('two');created('r2');done('r2',[],'incomplete','max_output_tokens');
  commit('three');created('r3');lifecycle.close('session_shutdown');
  expect(record.mock.calls.map(([,step])=>step)).toEqual(['start','interrupted','start','unfinished','start','unfinished']);
  expect(trace).toHaveBeenCalledWith('response_done',1,1,'turn_detected');
  expect(trace).toHaveBeenCalledWith('response_done',2,2,'max_output_tokens');
 });
});
