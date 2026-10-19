import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {OpenAIInterviewConversation} from './OpenAIInterviewConversation.js';
import {interviewTurnDetection} from '../../../supabase/functions/recruitment-realtime/turnDetection.ts';
import fixture from '../../../qa/recruitment/safariTurnRecovery.fixture.json';
let c,send,recovery,input,accepted,rejected,view;
const e=x=>c.event(x);
const response=(id='entry',kind='entry',owner='session:1')=>e({type:'response.created',response:{id,metadata:{feedx_kind:kind,owner}}});
const drain=(id='entry')=>{e({type:'response.output_item.added',response_id:id,item:{type:'message',id:`ai-${id}`}});e({type:'output_audio_buffer.started',response_id:id});e({type:'response.done',response:{id,status:'completed'}});e({type:'output_audio_buffer.stopped',response_id:id});};
const speak=(text,id='answer')=>{e({type:'input_audio_buffer.speech_started',item_id:id});e({type:'input_audio_buffer.speech_stopped',item_id:id});e({type:'input_audio_buffer.committed',item_id:id});e({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text});};
beforeEach(()=>{vi.useFakeTimers();send=vi.fn();recovery=vi.fn();input=vi.fn();accepted=vi.fn();rejected=vi.fn();view=vi.fn();c=new OpenAIInterviewConversation({send,onRecovery:recovery,onInput:input,onTurnState:view,onAcceptCandidate:accepted,onRejectCandidate:rejected});c.controlled=true;c.presentationOwned=true;c.begin('session:1','entry');});
afterEach(()=>{c.close();vi.useRealTimers();});
it('provider policy removes both automatic response and automatic interruption; old clients remain compatible',()=>{
 expect(interviewTurnDetection('controlled-turns-v1')).toMatchObject({create_response:false,interrupt_response:false,eagerness:'low'});
 expect(interviewTurnDetection('provider-owned-v1')).toMatchObject({create_response:true,interrupt_response:true});
});
it('the historical provider responded before final transcription; controlled playback noise cannot own a turn',()=>{
 const firstCandidate=fixture.audio.find(r=>r.type==='input_audio_buffer.speech_started');
 const nextResponse=fixture.audio.find(r=>r.type==='response.created'&&r.elapsed_ms>firstCandidate.elapsed_ms);
 const transcript=fixture.audio.find(r=>r.phase==='transcription_completed');
 expect(nextResponse.elapsed_ms).toBeLessThan(transcript.elapsed_ms);
 response();e({type:'output_audio_buffer.started',response_id:'entry'});
 speak('Do you have prior experience in the F&B industry?','noise');
 expect(rejected).toHaveBeenCalledWith('noise');expect(accepted).not.toHaveBeenCalled();
 expect(c.owner).toBeNull();expect(c.revision).toBe(0);expect(c.playing).toBe(true);
 expect(send.mock.calls.filter(([x])=>x.type==='response.create')).toHaveLength(1);
 expect(send.mock.calls.some(([x])=>x.type==='response.cancel')).toBe(false);
});
it.each(['Yes','嗯','Um.','Boleh','我可以做晚班。','Saya boleh kerja weekend, 没问题','我之前喺茶餐廳幫過手。'])('quiet/short/multilingual answer waits for exactly one deliberate submission: %s',text=>{
 response();drain();speak(text);
 expect(accepted).not.toHaveBeenCalled();expect(c.confirmAnswer()).toBe(true);expect(c.confirmAnswer()).toBe(false);
 expect(accepted).toHaveBeenCalledOnce();expect(accepted).toHaveBeenCalledWith('answer');
 expect(send.mock.calls.filter(([x])=>x.type==='response.create')).toHaveLength(2);
 response('reply','answer',c.acceptedOwner);drain('reply');vi.advanceTimersByTime(31000);expect(recovery).not.toHaveBeenCalled();
});
it('thinking pauses collect several segments without auto follow-up or evidence publication',()=>{
 response();drain();speak('I worked in a cafe.','one');vi.advanceTimersByTime(45000);speak('I helped customers with orders.','two');
 expect(recovery).not.toHaveBeenCalled();expect(accepted).not.toHaveBeenCalled();
 expect(view.mock.lastCall[0].text).toContain('I worked in a cafe. I helped');
 expect(c.confirmAnswer()).toBe(true);expect(accepted).toHaveBeenCalledTimes(2);
 expect(send.mock.calls.filter(([x])=>x.type==='response.create')).toHaveLength(2);
});
it.each(['[breathing]','(noise)','...'])('nonverbal transcript is discarded without advancing: %s',text=>{
 response();drain();speak(text);expect(c.confirmAnswer()).toBe(false);expect(rejected).toHaveBeenCalledWith('answer');expect(accepted).not.toHaveBeenCalled();
});
it('explicit interruption closes old response ownership and opens input only after acknowledgement',()=>{
 response();e({type:'response.output_item.added',response_id:'entry',item:{type:'message',id:'ai-entry'}});e({type:'output_audio_buffer.started',response_id:'entry'});
 expect(c.interrupt()).toBe(true);expect(c.interrupt()).toBe(false);expect(c.inputOpen).toBe(false);
 e({type:'output_audio_buffer.cleared',response_id:'entry'});expect(c.inputOpen).toBe(true);
 speak('I have a question.');expect(c.confirmAnswer()).toBe(true);expect(accepted).toHaveBeenCalledOnce();
 expect(send.mock.calls.filter(([x])=>x.type==='response.create')).toHaveLength(2);
 expect(send.mock.calls.some(([x])=>x.type==='response.create'&&x.response.instructions==='entry')).toBe(true);
});
it('unacknowledged explicit interruption and accepted turn with no response converge to recovery',()=>{
 response();expect(c.interrupt()).toBe(true);vi.advanceTimersByTime(8100);expect(recovery).toHaveBeenCalledWith('interruption_ack_timeout');
});
it('a duplicate controlled response cannot replay accepted speech',()=>{
 response();drain();speak('I can start next week.');c.confirmAnswer();response('reply','answer',c.acceptedOwner);response('duplicate','answer',c.acceptedOwner);
 expect(recovery).toHaveBeenCalledWith('duplicate_controlled_response');
});
it('missing next response after Send is bounded, without retrying/replaying it',()=>{
 response();drain();speak('I can start next week.');c.confirmAnswer();vi.advanceTimersByTime(30100);
 expect(recovery).toHaveBeenCalledWith('accepted_answer_response_timeout');expect(send.mock.calls.filter(([x])=>x.type==='response.create')).toHaveLength(2);
});
it('discard and late transcription cannot resurrect a draft or accept evidence',()=>{
 response();drain();e({type:'input_audio_buffer.speech_started',item_id:'old'});c.clearAnswer();speak('old hallucination','old');
 expect(c.confirmAnswer()).toBe(false);expect(accepted).not.toHaveBeenCalled();
 c.close();speak('stale answer','stale');expect(accepted).not.toHaveBeenCalled();
});
it('completion tool stays single-owned and input remains gated until its spoken continuation drains',async()=>{
 response();drain();speak('No further questions.');c.confirmAnswer();c.onTool=vi.fn().mockResolvedValue({can_finish:true});
 response('tool','answer',c.acceptedOwner);e({type:'response.function_call_arguments.done',response_id:'tool',call_id:'call',name:'request_completion'});
 e({type:'response.done',response:{id:'tool',status:'completed'}});await vi.advanceTimersByTimeAsync(0);
 expect(c.inputOpen).toBe(false);e({type:'response.created',response:{id:'close',metadata:{feedx_kind:'tool',call_id:'call'}}});drain('close');
 expect(send.mock.calls.filter(([x])=>x.type==='response.create'&&x.response.metadata.feedx_kind==='tool')).toHaveLength(1);
});
it('buffer/session acknowledgements cannot reopen input between Send and response.created',()=>{
 response();drain();speak('I can work weekends.');c.confirmAnswer();
 e({type:'input_audio_buffer.cleared'});e({type:'session.updated'});expect(c.inputOpen).toBe(false);
 speak('output echo','late-noise');expect(accepted).toHaveBeenCalledOnce();
 expect(rejected).toHaveBeenCalledWith('late-noise');
});
it('a new speech segment cannot erase the bounded pending transcription of the preceding segment',()=>{
 response();drain();e({type:'input_audio_buffer.speech_started',item_id:'one'});e({type:'input_audio_buffer.speech_stopped',item_id:'one'});
 e({type:'input_audio_buffer.speech_started',item_id:'two'});vi.advanceTimersByTime(15100);expect(recovery).toHaveBeenCalledWith('transcription_timeout');
});
