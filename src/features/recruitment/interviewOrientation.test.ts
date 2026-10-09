import {it, expect, vi, afterEach} from 'vitest';
import {meaningfulSpeech, orientationComplete} from '../../../supabase/functions/recruitment-realtime/orientation.ts';
import {interviewInstructions} from '../../../supabase/functions/recruitment-realtime/prompt.ts';
import {OpenAIInterviewConversation} from './OpenAIInterviewConversation.js';
import physical from '../../../qa/recruitment/physicalOrientation.fixture.json';
const adapters: OpenAIInterviewConversation[]=[];
afterEach(()=>adapters.forEach(a=>a.close()));
const context={generation:1, preferred_language:'zh' as const,orientation_complete:false,target_minutes:10,required_topics:[],scenario_briefs:[],language_guidance:'',interview_instructions:'',turns:physical.turns.slice(0,5),topics:[],scenarios:[],employment_preference:'unknown' as const};
it.each(['Hello.','Hi there.','OK','Yes!','嗯','好','lah','hello hello','Hmm...'])('short acknowledgement %s does not establish language',text=>expect(meaningfulSpeech(text)).toBe(false));
it.each(['你可以讲华语吗?','我是找part time的.','I can start next week.','主要是service啦.'])('meaningful speech or request survives %s',text=>expect(meaningfulSpeech(text)).toBe(true));
it('physical 37-turn case retains pending orientation and Mandarin fallback after two short greetings',()=>{
 expect(physical.version).toBe(2);expect(physical.turns).toHaveLength(37);
 const instructions=interviewInstructions(context);
 expect(instructions).toContain('Orientation is pending');
 expect(instructions).toContain('Greeting / ambiguity fallback language only: Mandarin');
 expect(instructions).not.toContain('The starting preference no longer applies');
 expect(instructions).toContain('before offering-specific availability or schedule questions');
 expect(instructions).toContain('Never narrate tools');
 expect(physical.turns[15].transcript).toContain('早上7点半');
 expect(physical.turns[16].transcript).toContain('part time');
});
const delivered={speaker:'ai',turn_number:1,provider_generation:1,provider_item_id:'orientation',transcript:'Opening'};
const intro={speaker:'candidate',turn_number:2,transcript:'我做过三个月餐饮服务。'};
const checkpoint={provider_generation:1,record:{type:'output_audio_buffer.stopped',phase:'orientation_complete',item_id:'orientation'}};
it('durable checkpoint requires a matching nontruncated delivered item and meaningful later candidate speech',()=>{
 expect(orientationComplete([delivered,intro],[],[checkpoint])).toBe(true);
 expect(orientationComplete([delivered,intro],[{kind:'truncated',provider_generation:1,provider_item_id:'orientation'}],[checkpoint])).toBe(false);
 expect(orientationComplete([delivered,{...intro,transcript:'Hello'}],[],[checkpoint])).toBe(false);
 expect(orientationComplete([delivered,intro],[],[{...checkpoint,provider_generation:2}])).toBe(false);
});
function setup(){
 const send=vi.fn(),receipt=vi.fn(),tool=vi.fn();
 const a=new OpenAIInterviewConversation({send,onRecovery:vi.fn(),onTool:tool,onOrientation:receipt});
 adapters.push(a);a.orientationRequired=true;a.instructions=interviewInstructions(context);
 const emit=(type:string,other:any={})=>a.event({type,...other});
 const response=(id:string)=>{emit('response.created',{response:{id}});emit('response.output_item.added',{response_id:id,item:{id:id+'-item',type:'message'}});};
 const candidate=(id:string)=>{emit('input_audio_buffer.speech_started',{item_id:id});emit('input_audio_buffer.committed',{item_id:id});emit('input_audio_buffer.speech_stopped',{item_id:id});};
 const confirm=(id:string)=>{emit('response.function_call_arguments.done',{response_id:id,call_id:id+'-call',name:'confirm_orientation'});emit('response.done',{response:{id,status:'completed'}});};
 return {a,send,receipt,tool,emit,response,candidate,confirm};
}
it('cancelled opening + Hello cannot complete orientation; one subsequent provider response can finish missing orientation',()=>{
 const s=setup();s.response('opening');s.emit('response.done',{response:{id:'opening',status:'cancelled'}});s.emit('output_audio_buffer.cleared',{response_id:'opening'});
 s.candidate('hello');s.response('after-hello');s.confirm('after-hello');expect(s.receipt).not.toHaveBeenCalled();expect(s.a.orientationRequired).toBe(true);
});
it('checkpoint waits for its own full delivered orientation, then listens without another response',()=>{
 const s=setup();s.response('opening');s.emit('response.function_call_arguments.done',{response_id:'opening',call_id:'opening-call',name:'confirm_orientation'});
 s.emit('response.done',{response:{id:'opening',status:'completed'}});expect(s.receipt).not.toHaveBeenCalled();
 s.emit('output_audio_buffer.stopped',{response_id:'opening'});
 expect(s.receipt).toHaveBeenCalledOnce();expect(s.receipt).toHaveBeenCalledWith({response_id:'opening',item_id:'opening-item'});
 expect(s.a.orientationRequired).toBe(false);expect(s.a.introductionPending).toBe(true);
 expect(s.send.mock.calls.filter(([e])=>e.type==='response.create')).toHaveLength(0);
 s.emit('response.function_call_arguments.done',{response_id:'opening',call_id:'opening-call',name:'confirm_orientation'});expect(s.receipt).toHaveBeenCalledOnce();
 s.candidate('hello');s.emit('conversation.item.input_audio_transcription.completed',{item_id:'hello',transcript:'Hello'});expect(s.a.introductionPending).toBe(true);
 s.candidate('intro');s.emit('conversation.item.input_audio_transcription.completed',{item_id:'intro',transcript:'我做过三个月餐饮服务。'});expect(s.a.introductionPending).toBe(false);
 s.a.updateContext(interviewInstructions(context));expect(s.a.instructions).toContain('Orientation is complete');expect(s.a.instructions).not.toContain('Orientation is pending');
});
it('interrupting a checkpoint response fences later done/stopped receipts',()=>{
 const s=setup();s.response('opening');s.emit('response.function_call_arguments.done',{response_id:'opening',call_id:'opening-call',name:'confirm_orientation'});
 s.candidate('hello');s.emit('response.done',{response:{id:'opening',status:'completed'}});s.emit('output_audio_buffer.stopped',{response_id:'opening'});
 expect(s.receipt).not.toHaveBeenCalled();expect(s.a.orientationRequired).toBe(true);
});
it('late opening callbacks cannot advance a newer turn or bypass server completion',()=>{
 const s=setup();s.response('old');s.candidate('new');s.confirm('old');expect(s.receipt).not.toHaveBeenCalled();expect(s.send).not.toHaveBeenCalled();
 s.response('pending');s.emit('response.function_call_arguments.done',{response_id:'pending',call_id:'close',name:'request_completion'});expect(s.tool).not.toHaveBeenCalled();
});
it('Unknown and Part Time provider payloads cannot expose Full Time schedule terms',()=>{
 const offers=[{id:'ft',employment_type:'full_time',schedule:'07:30–17:00 Full Time'},{id:'pt',employment_type:'part_time',schedule:'Availability agreed with Supervisor',amount_min:8}];
 const unknown=interviewInstructions({...context,employment_offerings:offers});
 expect(unknown).toContain('Available offering TYPES only');expect(unknown).not.toContain('07:30');expect(unknown).not.toContain('amount_min');
 const pt=interviewInstructions({...context,employment_offerings:offers,employment_preference:'part_time'});
 expect(pt).toContain('Availability agreed with Supervisor');expect(pt).toContain('amount_min');expect(pt).not.toContain('07:30');
 const both=interviewInstructions({...context,employment_offerings:offers,employment_preference:'both'});expect(both).toContain('07:30');expect(both).toContain('Availability agreed');
});
it('a late transcript preceding the delivered opening cannot complete the introduction opportunity',()=>{
 const s=setup();s.candidate('early');s.response('orientation');s.emit('response.function_call_arguments.done',{response_id:'orientation',call_id:'orientation-call',name:'confirm_orientation'});
 s.emit('response.done',{response:{id:'orientation',status:'completed'}});s.emit('output_audio_buffer.stopped',{response_id:'orientation'});
 s.emit('conversation.item.input_audio_transcription.completed',{item_id:'early',transcript:'I worked in a cafe.'});
 expect(s.a.introductionPending).toBe(true);
});
it('V4 physical tool-only checkpoint cannot wait forever for audio that never existed',()=>{
 const s=setup();
 s.response('opening');s.emit('output_audio_buffer.started',{response_id:'opening'});
 s.candidate('disputed');s.emit('output_audio_buffer.cleared',{response_id:'opening'});
 s.emit('response.done',{response:{id:'opening',status:'cancelled'}});
 s.emit('response.created',{response:{id:'tool-only'}});
 s.emit('response.function_call_arguments.done',{response_id:'tool-only',call_id:'confirm',name:'confirm_orientation'});
 s.emit('response.done',{response:{id:'tool-only',status:'completed'}});
 expect(s.receipt).not.toHaveBeenCalled();
 expect(s.send.mock.calls.filter(([e])=>e.type==='response.create')).toHaveLength(1);
 expect(s.send.mock.calls.find(([e])=>e.type==='conversation.item.create')?.[0].item.output).toContain('orientation_delivered":false');
 s.emit('response.done',{response:{id:'tool-only',status:'completed'}});
 expect(s.send.mock.calls.filter(([e])=>e.type==='response.create')).toHaveLength(1);
});
it('orientation audio drain before response.done advances exactly once',()=>{
 const s=setup();s.response('opening');
 s.emit('response.function_call_arguments.done',{response_id:'opening',call_id:'confirm',name:'confirm_orientation'});
 s.emit('output_audio_buffer.stopped',{response_id:'opening'});
 s.emit('response.done',{response:{id:'opening',status:'completed'}});
 expect(s.receipt).toHaveBeenCalledOnce();
 expect(s.a.orientationRequired).toBe(false);
});
