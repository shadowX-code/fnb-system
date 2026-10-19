import {beforeEach,expect,it,vi} from 'vitest';
const qa=vi.hoisted(()=>({put:vi.fn(),annotation:vi.fn(),turn:vi.fn()}));
vi.mock('./interviewTranscriptQueue.js',()=>({interviewTranscriptQueue:{put:qa.put,list:vi.fn().mockResolvedValue([]),remove:vi.fn()}}));
vi.mock('./recruitmentService.js',()=>({recruitmentService:{annotation:qa.annotation,transcriptTurn:qa.turn}}));
import {InterviewTranscriptEvidence} from './InterviewTranscriptEvidence.js';
let evidence;
beforeEach(()=>{vi.clearAllMocks();evidence=new InterviewTranscriptEvidence({token:'token',clientId:'client',startedAt:new Date().toISOString()});evidence.attemptKey='fixture';evidence.generation=1;evidence.requireAcceptance=true;});
function answer(id,text,overlap=false){
 if(overlap)evidence.observe({type:'output_audio_buffer.started',response_id:'ai'});
 for(const type of ['speech_started','speech_stopped','committed'])evidence.observe({type:`input_audio_buffer.${type}`,item_id:id});
 evidence.observe({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:text});
}
it('recognized text alone never publishes candidate evidence; explicit accepted text retains source timing',async()=>{
 answer('candidate','我可以做周末。');await evidence.persistence;expect(qa.put).not.toHaveBeenCalled();
 const end=evidence.pendingCandidates.get('candidate').elapsedMs;
 expect(evidence.acceptCandidate('candidate')).toBe(true);await evidence.persistence;
 expect(qa.put).toHaveBeenCalledWith(expect.objectContaining({speaker:'candidate',transcript:'我可以做周末。',elapsedMs:end}));
 expect(evidence.acceptCandidate('candidate')).toBe(false);
});
it('discarded or unsubmitted text is preserved as unverified before any raw turn can reach intelligence',async()=>{
 answer('noise','A hallucinated question');evidence.rejectCandidate('noise');await evidence.persistence;
 const calls=qa.put.mock.calls.map(([x])=>x);
 expect(calls[0].kind).toBe('unverified_candidate');expect(calls[1].transcript).toBe('A hallucinated question');
 expect(evidence.candidateEligible('noise')).toBe(false);
});
it('overlapping output can never be confirmed as candidate evidence',async()=>{
 answer('echo','Interviewer echo',true);expect(evidence.acceptCandidate('echo')).toBe(false);
 evidence.close();await evidence.persistence;
 expect(qa.put.mock.calls.some(([x])=>x.kind==='unverified_candidate')).toBe(true);
});
it('background/close quarantines an unsubmitted answer, preserving acknowledged historical evidence',async()=>{
 answer('old','I worked at a cafe.');evidence.acceptCandidate('old');await evidence.persistence;
 answer('draft','Unsubmitted draft');evidence.close();await evidence.persistence;
 expect(qa.put.mock.calls.filter(([x])=>x.kind==='unverified_candidate').map(([x])=>x.itemId)).toEqual(['draft']);
});
