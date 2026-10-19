import {afterEach,expect,it,vi} from 'vitest';
import {OpenAIInterviewConversation} from './OpenAIInterviewConversation.js';
import {firstInterviewResponse,interviewInstructions} from '../../../supabase/functions/recruitment-realtime/prompt.ts';
import physical from '../../../qa/recruitment/physical26Audio.fixture.json';
const adapters: OpenAIInterviewConversation[]=[];
afterEach(()=>{adapters.forEach(a=>a.close());vi.useRealTimers();});
function setup(eligible=()=>true){
 vi.useFakeTimers();const send=vi.fn(),recovery=vi.fn(),receipt=vi.fn();
 const a=new OpenAIInterviewConversation({send,onRecovery:recovery,onOrientation:receipt,onTool:vi.fn(),candidateEligible:eligible});
 a.presentationOwned=true;a.orientationRequired=true;a.instructions='[FEEDX ORIENTATION]pending[/FEEDX ORIENTATION]';adapters.push(a);
 return {a,send,recovery,receipt,event:(e:any)=>a.event(e)};
}
const create=(id:string,metadata={})=>({type:'response.created',response:{id,metadata}});
const done=(id:string)=>({type:'response.done',response:{id,status:'completed'}});
it('physical 26-turn trace proves repeated clears, missing orientation receipts and false orientation timeout',()=>{
 expect(physical.turn_count).toBe(26);
 expect(physical.events.filter(e=>e.type==='output_audio_buffer.cleared')).toHaveLength(11);
 expect(physical.events.some(e=>e.phase==='orientation_complete')).toBe(false);
 expect(physical.events.some(e=>e.status==='orientation_audio_timeout')).toBe(true);
});
it('a long opening drains without the physical 15-second tool timeout or a replay response',()=>{
 const s=setup();s.a.begin('entry','opening');s.event(create('opening',{feedx_kind:'entry'}));
 s.event({type:'response.output_item.added',response_id:'opening',item:{id:'opening-item',type:'message'}});
 s.event({type:'output_audio_buffer.started',response_id:'opening'});s.event(done('opening'));
 vi.advanceTimersByTime(20000);expect(s.recovery).not.toHaveBeenCalled();
 s.event({type:'output_audio_buffer.stopped',response_id:'opening'});
 expect(s.receipt).toHaveBeenCalledWith({phase:'dialogue_committed',response_id:'opening',item_id:'opening-item'});
 expect(s.send.mock.calls.filter(([e])=>e.type==='response.create')).toHaveLength(1);
});
it('interrupted orientation and a meaningful answer advance without a model confirmation gate',()=>{
 const s=setup();s.a.begin('entry','opening');s.event(create('opening',{feedx_kind:'entry'}));
 s.event({type:'input_audio_buffer.speech_started',item_id:'answer'});
 s.event({type:'output_audio_buffer.cleared',response_id:'opening'});
 s.event({type:'input_audio_buffer.speech_stopped',item_id:'answer'});s.event({type:'input_audio_buffer.committed',item_id:'answer'});
 s.event({type:'conversation.item.input_audio_transcription.completed',item_id:'answer',transcript:'我在咖啡店做过三个月。'});
 s.event(create('next'));s.event(done('next'));
 expect(s.a.orientationRequired).toBe(false);expect(s.a.introductionPending).toBe(false);
 expect(s.a.instructions).toContain('Never restart');expect(s.recovery).not.toHaveBeenCalled();
 expect(s.send.mock.calls.filter(([e])=>e.type==='response.create')).toHaveLength(1);
});
it('late legacy confirmation cannot generate the physical negative-receipt replay loop',()=>{
 const s=setup();s.event(create('tool'));s.event({type:'response.function_call_arguments.done',response_id:'tool',call_id:'c',name:'confirm_orientation'});s.event(done('tool'));
 vi.advanceTimersByTime(20000);expect(s.recovery).not.toHaveBeenCalled();
 expect(s.send.mock.calls.filter(([e])=>e.type==='response.create')).toHaveLength(0);
});
it('late old clear/stop cannot set the newest response audio to idle',()=>{
 const s=setup();s.event(create('old'));s.event(create('new'));
 s.event({type:'output_audio_buffer.started',response_id:'new'});
 s.event({type:'output_audio_buffer.cleared',response_id:'old'});s.event({type:'output_audio_buffer.stopped',response_id:'old'});
 expect(s.a.playing).toBe(true);expect(s.a.activeAudioResponse).toBe('new');
});
it('repeated uncertain input converges to explicit recovery without manufacturing evidence or responses',()=>{
 const s=setup(()=>false);
 for(let i=0;i<3;i++) s.event({type:'conversation.item.input_audio_transcription.completed',item_id:'noise'+i,transcript:'uncertain'});
 expect(s.recovery).toHaveBeenCalledWith('repeated_unverified_input');
 expect(s.send.mock.calls.filter(([e])=>e.type==='response.create')).toHaveLength(0);
});
it('replacement context never re-enters pending orientation despite the historical missing tool checkpoint',()=>{
 const context:any={conversation_protocol:'continuity-v2',generation:2,orientation_complete:false,orientation_presented:false,preferred_language:'zh',target_minutes:10,remaining_seconds:500,required_topics:[],scenario_briefs:[],turns:[],topics:[],scenarios:[]};
 const instructions=firstInterviewResponse(context);
 expect(instructions).toContain('continue the same interview naturally');expect(instructions).not.toContain('continue the pending introduction phase');
 expect(interviewInstructions(context)).not.toContain('Orientation is pending');
});
it('replaying generation 1 physical control boundaries reproduces the old false timeout, removed in v2',()=>{
 function replay(presentationOwned:boolean){
  const s=setup();s.a.presentationOwned=presentationOwned;s.a.begin('entry','opening');
  let elapsed=physical.events.find(e=>e.generation===1)?.elapsed_ms || 0;
  let first=true;
  const tools=new Set(physical.events.filter(e=>e.type==='response.function_call_arguments.done').map(e=>e.item_id));
  for(const raw of physical.events.filter(e=>e.generation===1 && e.elapsed_ms!=null)){
   vi.advanceTimersByTime(Math.max(0,raw.elapsed_ms-elapsed));elapsed=raw.elapsed_ms;
   if(raw.phase || raw.type.startsWith('client.') || raw.type.startsWith('transport.') || raw.type.startsWith('playback.'))continue;
   const e:any={...raw};
   if(e.type==='response.created'){e.response={id:e.response_id,metadata:first?{feedx_kind:'entry'}:{}};first=false;}
   if(e.type==='response.done')e.response={id:e.response_id,status:e.status};
   if(e.type==='response.output_item.added')e.item={id:e.item_id,type:tools.has(e.item_id)?'function_call':'message'};
   // Retained diagnostics omit tool arguments/name. The observed orientation
   // timeout identifies this legacy contract; no candidate words are fabricated.
   if(e.type==='response.function_call_arguments.done'){e.call_id=e.item_id;e.name='confirm_orientation';}
   s.event(e);
  }
  s.a.close();return s;
 }
 const legacy=replay(false);expect(legacy.recovery).toHaveBeenCalledWith('orientation_audio_timeout');
 const corrected=replay(true);expect(corrected.recovery).not.toHaveBeenCalledWith('orientation_audio_timeout');
 expect(corrected.send.mock.calls.filter(([e])=>e.type==='response.create')).toHaveLength(1);
});
