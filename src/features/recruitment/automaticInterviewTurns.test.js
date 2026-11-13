import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {OpenAIInterviewConversation} from './OpenAIInterviewConversation.js';
import {automaticTurnDecision} from './interviewTurnAcceptance.js';
import {interviewTurnDetection} from '../../../supabase/functions/recruitment-realtime/turnDetection.ts';
import fixture from '../../../qa/recruitment/safariTurnRecovery.fixture.json';
let c,send,accepted,rejected,recovery,view;
const event=e=>c.event(e);
const response=(id='entry',kind='entry',owner='generation:1')=>event({type:'response.created',response:{id,metadata:{feedx_kind:kind,owner}}});
const drain=(id='entry')=>{
 event({type:'response.output_item.added',response_id:id,item:{type:'message',id:'ai-'+id}});
 event({type:'output_audio_buffer.started',response_id:id});
 event({type:'response.done',response:{id,status:'completed'}});
 event({type:'output_audio_buffer.stopped',response_id:id});
};
const start=(id='candidate')=>event({type:'input_audio_buffer.speech_started',item_id:id,audio_start_ms:1000});
const finish=(text,id='candidate',logprobs=[{logprob:-0.05}])=>{
 event({type:'input_audio_buffer.speech_stopped',item_id:id,audio_end_ms:2200});
 event({type:'input_audio_buffer.committed',item_id:id});
 event({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text,logprobs});
};
const answer=(text,id='candidate',lp)=>{start(id);finish(text,id,lp);};
const count=()=>send.mock.calls.filter(([e])=>e.type==='response.create').length;
beforeEach(()=>{
 vi.useFakeTimers();send=vi.fn();accepted=vi.fn();rejected=vi.fn();recovery=vi.fn();view=vi.fn();
 c=new OpenAIInterviewConversation({send,onRecovery:recovery,onAcceptCandidate:accepted,onRejectCandidate:rejected,onTurnState:view});
 c.controlled=true;c.automatic=true;c.presentationOwned=true;c.begin('generation:1','Opening');response();drain();
});
afterEach(()=>{c.close();vi.useRealTimers();});
it('automatic policy still disables provider interruption and response creation',()=>{
 expect(interviewTurnDetection('controlled-auto-v1')).toMatchObject({eagerness:'low',create_response:false,interrupt_response:false});
});
it.each(['Yes','Boleh','我可以做晚班。','我之前喺茶餐廳幫過手。','Saya boleh kerja weekend, 没问题'])('automatically accepts short/quiet/multilingual speech, once: %s',text=>{
 answer(text);expect(accepted).toHaveBeenCalledOnce();expect(c.acceptanceMode).toBe('automatic');expect(count()).toBe(2);
 finish(text);expect(count()).toBe(2);expect(c.confirmAnswer()).toBe(false);
 response('reply','answer',c.acceptedOwner);drain('reply');finish(text);expect(count()).toBe(2);
});
it('thinking pauses do not trigger responses before provider semantic EOS',()=>{
 start();vi.advanceTimersByTime(7000);expect(count()).toBe(1);expect(c.speaking).toBe(true);
 finish('I helped a customer find their order.');expect(count()).toBe(2);
});
it('a short hesitation remains a visible optional fallback; the subsequent answer advances without the hesitation',()=>{
 answer('Um.','hesitation');expect(count()).toBe(1);expect(view.mock.lastCall[0]).toMatchObject({uncertain:true,listening:true,canSend:true});
 answer('I served customers at a cafe.','real');expect(rejected).toHaveBeenCalledWith('hesitation');expect(accepted).toHaveBeenCalledWith('real');expect(count()).toBe(2);
 expect(send.mock.calls.findIndex(([e])=>e.type==='conversation.item.delete')).toBeLessThan(send.mock.calls.findLastIndex(([e])=>e.type==='response.create'));
});
it.each(['[breathing]','(noise)','...'])('noise does not advance conversation or become accepted evidence: %s',text=>{
 answer(text);expect(accepted).not.toHaveBeenCalled();expect(rejected).toHaveBeenCalledWith('candidate');expect(count()).toBe(1);
});
it.each([undefined,[],[{logprob:-3}],[{logprob:NaN}]])('missing/poor ASR certainty stays unaccepted with working fallback: %s',lp=>{
 start();event({type:'input_audio_buffer.speech_stopped',item_id:'candidate',audio_end_ms:2300});event({type:'input_audio_buffer.committed',item_id:'candidate'});
 event({type:'conversation.item.input_audio_transcription.completed',item_id:'candidate',transcript:'Possible words',logprobs:lp});
 expect(accepted).not.toHaveBeenCalled();expect(count()).toBe(1);expect(view.mock.lastCall[0].uncertain).toBe(true);
 expect(c.confirmAnswer()).toBe(true);expect(c.acceptanceMode).toBe('manual');expect(count()).toBe(2);
});
it('VAD timing is required; ASR alone cannot auto-accept',()=>{
 event({type:'input_audio_buffer.speech_started',item_id:'candidate'});finish('Clear text');expect(accepted).not.toHaveBeenCalled();expect(view.mock.lastCall[0].uncertain).toBe(true);
 expect(automaticTurnDecision({started:true,stopped:true,committed:true,startMs:100,endMs:180,logprobs:[{logprob:0}]},'Yes')).toBe('uncertain_boundaries');
});
it('delta logprobs are usable when the final event does not repeat them',()=>{
 start();event({type:'conversation.item.input_audio_transcription.delta',item_id:'candidate',delta:'Boleh',logprobs:[{logprob:-0.1}]});
 event({type:'input_audio_buffer.speech_stopped',item_id:'candidate',audio_end_ms:1500});event({type:'input_audio_buffer.committed',item_id:'candidate'});
 event({type:'conversation.item.input_audio_transcription.completed',item_id:'candidate',transcript:'Boleh'});expect(count()).toBe(2);
});
it('multiple in-flight finalized segments cannot cut off the current speaker or respond twice',()=>{
 start('one');event({type:'input_audio_buffer.speech_stopped',item_id:'one',audio_end_ms:2000});event({type:'input_audio_buffer.committed',item_id:'one'});
 start('two');event({type:'conversation.item.input_audio_transcription.completed',item_id:'one',transcript:'I worked in a cafe.',logprobs:[{logprob:-0.1}]});expect(count()).toBe(1);expect(c.speaking).toBe(true);
 finish('I served food.','two');expect(accepted).toHaveBeenCalledTimes(2);expect(count()).toBe(2);
});
it('physical output-overlap sequence cannot interrupt output, create evidence, or restart the opening',()=>{
 answer('I can work weekends.');response('reply','answer',c.acceptedOwner);event({type:'output_audio_buffer.started',response_id:'reply'});
 c.bargeInEnabled=true;
 for(const e of fixture.audio.filter(e=>e.type.startsWith('input_audio_buffer.')))event(e);
 finish('Apa pengalaman kerja awak?','noise');expect(count()).toBe(2);expect(accepted).toHaveBeenCalledOnce();
 expect(send.mock.calls.some(([e])=>e.type==='response.cancel')).toBe(false);
});
it.each(['Actually, I meant weekends.','等一下，我周末可以上班。','等一下, I can work weekends.'])('keeps the original overlapped utterance and replies once after both acknowledgements: %s',text=>{
 c.bargeInEnabled=true;
 answer('Yes');response('reply','answer',c.acceptedOwner);event({type:'output_audio_buffer.started',response_id:'reply'});
 start('interruption');
 c.observeBargeInSpeech(performance.now());
 c.observeBargeInSpeech(performance.now());start('interruption');
 expect(view.mock.lastCall[0]).toMatchObject({listening:true,speaking:false,canInterrupt:false});
 expect(send.mock.calls.filter(([e])=>e.type==='response.cancel')).toHaveLength(1);
 expect(send.mock.calls.filter(([e])=>e.type==='output_audio_buffer.clear')).toHaveLength(1);
 expect(count()).toBe(2);
 finish(text,'interruption');
 event({type:'output_audio_buffer.cleared',response_id:'reply'});
 expect(count()).toBe(2);
 event({type:'response.done',response:{id:'reply',status:'cancelled'}});
 expect(accepted).toHaveBeenLastCalledWith('interruption');expect(count()).toBe(3);
 response('next','answer',c.acceptedOwner);event({type:'output_audio_buffer.started',response_id:'next'});
 event({type:'output_audio_buffer.started',response_id:'reply'});
 event({type:'output_audio_buffer.cleared',response_id:'reply'});
 expect(c.activeAudioResponse).toBe('next');
 start('second-interruption');c.observeBargeInSpeech(performance.now());
 expect(send.mock.calls.filter(([e])=>e.type==='output_audio_buffer.clear')).toHaveLength(2);
});
it('a short overlapping segment cannot interrupt or become eligible after the output drains',()=>{
 c.bargeInEnabled=true;
 answer('Yes');response('reply','answer',c.acceptedOwner);event({type:'output_audio_buffer.started',response_id:'reply'});
 start('ack');event({type:'input_audio_buffer.speech_stopped',item_id:'ack',audio_end_ms:1100});
 c.observeBargeInSpeech(performance.now());drain('reply');finish('OK','ack');
 expect(accepted).toHaveBeenCalledOnce();
 expect(count()).toBe(2);
 expect(send.mock.calls.some(([e])=>e.type==='output_audio_buffer.clear')).toBe(false);
});
it('an interrupted closing tool cannot request another response or leave a stale timeout',async()=>{
 c.bargeInEnabled=true;
 let assess;
 c.onTool=()=>new Promise(resolve=>{assess=resolve;});
 answer('Yes');response('reply','answer',c.acceptedOwner);
 event({type:'output_audio_buffer.started',response_id:'reply'});
 event({type:'response.function_call_arguments.done',response_id:'reply',call_id:'closing',name:'request_completion'});
 await Promise.resolve();
 start('interruption');c.observeBargeInSpeech(performance.now());
 assess({can_finish:true});await Promise.resolve();
 event({type:'response.done',response:{id:'reply',status:'cancelled'}});
 event({type:'output_audio_buffer.cleared',response_id:'reply'});
 vi.advanceTimersByTime(65000);
 expect(recovery).not.toHaveBeenCalled();expect(count()).toBe(2);
});
it('deliberate interruption waits for cancellation acknowledgement before automatic listening resumes',()=>{
 answer('Yes');response('reply','answer',c.acceptedOwner);event({type:'output_audio_buffer.started',response_id:'reply'});
 expect(c.interrupt()).toBe(true);expect(c.inputOpen).toBe(false);event({type:'output_audio_buffer.cleared',response_id:'reply'});
 event({type:'response.done',response:{id:'reply',status:'cancelled'}});
 answer('Actually I can start next week.','correction');expect(count()).toBe(3);
});
it('accepted answer liveness is bounded without requesting duplicate speech; stale generations cannot advance',()=>{
 answer('Boleh');vi.advanceTimersByTime(30001);expect(recovery).toHaveBeenCalledWith('accepted_answer_response_timeout');expect(count()).toBe(2);
 c.close();answer('late','old');expect(count()).toBe(2);expect(accepted).toHaveBeenCalledOnce();
});
