import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OpenAIInterviewConversation } from "./OpenAIInterviewConversation.js";
import { continuationContext } from "../../../supabase/functions/recruitment-realtime/context.ts";
let adapter, send, recovery, tool, completion;
const event=e=>adapter.event(e);
const speech=(id="candidate")=>{event({type:"input_audio_buffer.speech_started",item_id:id});event({type:"input_audio_buffer.speech_stopped",item_id:id});};
const commit=(id="candidate")=>event({type:"input_audio_buffer.committed",item_id:id});
const created=(id="response",metadata)=>event({type:"response.created",response:{id,metadata}});
const done=(id="response",status="completed")=>event({type:"response.done",response:{id,status}});
beforeEach(()=>{vi.useFakeTimers();send=vi.fn();recovery=vi.fn();tool=vi.fn().mockResolvedValue({can_finish:false});completion=vi.fn();adapter=new OpenAIInterviewConversation({send,onRecovery:recovery,onTool:tool,onCompletion:completion});});
afterEach(()=>{adapter.close();vi.useRealTimers();});
it("entry is once-only; early live speech supersedes it",()=>{
 speech();adapter.begin("session:1","entry");adapter.begin("session:1","entry");expect(send).not.toHaveBeenCalled();
});
it("entry that loses ownership before acknowledgement is cancelled without replay",()=>{
 adapter.begin("session:1","entry");adapter.begin("session:1","entry");speech();created("entry",{feedx_kind:"entry"});
 expect(send.mock.calls.filter(([e])=>e.type==="response.create")).toHaveLength(1);
 expect(send).toHaveBeenLastCalledWith({type:"response.cancel",response_id:"entry"});
});
it.each(["I can start next week.","Yes","Okay","Boleh","我可以做晚班。","Saya boleh kerja weekend, 没问题"])("provider owns exactly one normal reply for %s",text=>{
 speech();commit();event({type:"conversation.item.input_audio_transcription.completed",item_id:"candidate",transcript:text});created();done();
 expect(send).not.toHaveBeenCalled();vi.advanceTimersByTime(90001);expect(recovery).not.toHaveBeenCalled();
});
it("thinking pauses do not generate client responses or impose a silence cutoff",()=>{
 event({type:"input_audio_buffer.speech_started",item_id:"candidate"});vi.advanceTimersByTime(20000);
 expect(send).not.toHaveBeenCalled();expect(recovery).not.toHaveBeenCalled();
 event({type:"input_audio_buffer.speech_stopped",item_id:"candidate"});vi.advanceTimersByTime(10000);commit();created();done();
 expect(recovery).not.toHaveBeenCalled();
});
it("a finalized candidate turn with no response ends in explicit recovery",()=>{
 speech();commit();vi.advanceTimersByTime(30001);expect(recovery).toHaveBeenCalledWith("next_response_timeout");expect(send).not.toHaveBeenCalled();
});
it("a late transcript cannot rearm a replied turn",()=>{
 speech();commit();created();done();event({type:"conversation.item.input_audio_transcription.completed",item_id:"candidate",transcript:"short"});vi.advanceTimersByTime(90001);expect(recovery).not.toHaveBeenCalled();
});
it("physical sequence: interrupted AI, new short reply, no old cancellation/playback receipt needed",()=>{
 adapter.begin("session:2","continue");created("entry",{feedx_kind:"entry"});event({type:"output_audio_buffer.started",response_id:"entry"});
 speech("boleh");commit("boleh");created("reply-1");
 // deliberately omit the old response.done and buffer.cleared receipts
 speech("okay");commit("okay");created("reply-2");done("reply-2");
 expect(send.mock.calls.filter(([e])=>e.type==="response.create")).toHaveLength(1);
 expect(send.mock.calls.filter(([e])=>e.type==="output_audio_buffer.clear")).toHaveLength(0);
 expect(recovery).not.toHaveBeenCalled();
});
it("background noise VAD events are observed; adapter adds no second interruption detector",()=>{
 created();event({type:"output_audio_buffer.started",response_id:"response"});speech("noise");
 expect(send).not.toHaveBeenCalled();
 // Whether that sound is real speech remains a provider/physical audio test.
});
it("tool result waits for generation completion only, not playback clearance",async()=>{
 speech();commit();created();event({type:"response.function_call_arguments.done",response_id:"response",call_id:"call",name:"request_completion"});
 await vi.advanceTimersByTimeAsync(1);expect(send).not.toHaveBeenCalled();done();
 expect(send.mock.calls.map(([e])=>e.type)).toEqual(["conversation.item.create","response.create"]);
 event({type:"response.function_call_arguments.done",response_id:"response",call_id:"call",name:"request_completion"});done();expect(tool).toHaveBeenCalledOnce();
});
it("late tool result cannot take a newer automatically-owned candidate turn",async()=>{
 let resolve;tool.mockReturnValue(new Promise(r=>resolve=r));speech();commit();created();event({type:"response.function_call_arguments.done",response_id:"response",call_id:"call",name:"request_completion"});
 await vi.advanceTimersByTimeAsync(1);done();speech("next");commit("next");created("next-response");resolve({can_finish:true});await vi.advanceTimersByTimeAsync(1);expect(send).not.toHaveBeenCalled();expect(completion).not.toHaveBeenCalled();
});
it("intentional completion is authorized and waits for its own closing audio",async()=>{
 tool.mockResolvedValue({can_finish:true});speech();commit();created();event({type:"response.function_call_arguments.done",response_id:"response",call_id:"call",name:"request_completion"});done();await vi.advanceTimersByTimeAsync(1);
 created("closing",{feedx_kind:"tool",call_id:"call"});done("closing");event({type:"output_audio_buffer.stopped",response_id:"response"});expect(completion).not.toHaveBeenCalled();event({type:"output_audio_buffer.stopped",response_id:"closing"});await vi.advanceTimersByTimeAsync(0);expect(completion).toHaveBeenCalledOnce();
});
it("automatic response and tool continuation cannot compete",async()=>{
 speech();commit();created();event({type:"response.function_call_arguments.done",response_id:"response",call_id:"call",name:"request_completion"});
 // Different explicit provider response represents a competing continuation.
 created("other",{feedx_kind:"external"});done();await vi.advanceTimersByTimeAsync(1);
 expect(send).not.toHaveBeenCalled();expect(recovery).toHaveBeenCalledWith("tool_response_conflict");
});
it("unexpected duplicate ordinary provider response is cancelled and recovers instead of speaking twice",()=>{
 speech();commit();created();created("duplicate");expect(recovery).toHaveBeenCalledWith("duplicate_provider_response");expect(send).toHaveBeenCalledWith({type:"response.cancel",response_id:"duplicate"});
});
it("closed generation ignores events, late tool results and context updates",async()=>{
 let resolve;tool.mockReturnValue(new Promise(r=>resolve=r));created();event({type:"response.function_call_arguments.done",response_id:"response",call_id:"call",name:"request_completion"});await vi.advanceTimersByTimeAsync(1);adapter.close();resolve({can_finish:true});await vi.advanceTimersByTimeAsync(1);commit();adapter.updateContext("new");expect(send).not.toHaveBeenCalled();
});
it("material context updates are quiet, deduplicated and never replay history",()=>{
 adapter.updateContext("canonical evidence");adapter.updateContext("canonical evidence");expect(send.mock.calls.map(([e])=>e.type)).toEqual(["session.update"]);
});
it("server update uses pinned plan, cited facts and excludes truncated history",()=>{
 const state={max_ends_at:new Date(Date.now()+300000).toISOString(),topics:[{topic_index:0,topic:"experience",state:"covered",evidence_turn_id:"c"}],scenarios:[{scenario_index:0,brief:"complaint",state:"asked"}],turns:[{id:"a",speaker:"ai",provider_generation:1,provider_item_id:"a",transcript:"unheard",turn_number:1},{id:"c",speaker:"candidate",provider_generation:1,provider_item_id:"c",transcript:"Saya worked at a café",turn_number:2}]};
 const context=continuationContext(state,{provider_generation:2},{target_minutes:9,required_topics:["experience"],scenario_briefs:["complaint"],language_guidance:"EN/BM/Chinese",interview_instructions:"F&B"},{opening_title_snapshot:"Crew",opening_description_snapshot:"Service"},[{provider_generation:1,provider_item_id:"a",kind:"truncated"}]);
 expect(context.turns.map(t=>t.id)).toEqual(["c"]);expect(context.established_facts[0].statement).toBe("Saya worked at a café");expect(context.scenarios[0].state).toBe("asked");expect(context.remaining_seconds).toBe(300);
});

it("replays the saved physical interruption sequence without client response scheduling",async()=>{
 const {default:fixture}=await import("../../../qa/recruitment/physicalInterruption.fixture.json");
 adapter.begin("session:2","continuation");
 for(const e of fixture.events) {
   if(e.type==="response.created")event({type:e.type,response:{id:e.response_id,metadata:e.response_id==="response-1"?{feedx_kind:"entry"}:undefined}});
   else if(e.type==="response.done")event({type:e.type,response:{id:e.response_id,status:e.status}});
   else event(e);
 }
 expect(send.mock.calls.filter(([e])=>e.type==="response.create")).toHaveLength(1);
 expect(send.mock.calls.filter(([e])=>e.type==="output_audio_buffer.clear")).toHaveLength(0);
 expect(recovery).not.toHaveBeenCalled();
});

it.each(["drain-first","done-first"])("authorized closing converges exactly once in %s event order without another utterance",async order=>{
 tool.mockResolvedValue({can_finish:true});speech();commit();created();event({type:"response.function_call_arguments.done",response_id:"response",call_id:"close-call",name:"request_completion"});done();await vi.advanceTimersByTimeAsync(1);
 created("closing",{feedx_kind:"tool",call_id:"close-call"});
 const drain=()=>event({type:"output_audio_buffer.stopped",response_id:"closing"});
 if(order==="drain-first"){drain();expect(completion).not.toHaveBeenCalled();done("closing");}else{done("closing");expect(completion).not.toHaveBeenCalled();drain();}
 await vi.advanceTimersByTimeAsync(0);drain();done("closing");await vi.advanceTimersByTimeAsync(0);
 expect(completion).toHaveBeenCalledOnce();
 expect(send.mock.calls.filter(([e])=>e.type==="response.create")).toHaveLength(1);
});
it("a cancelled authorized closing never auto-submits",async()=>{
 tool.mockResolvedValue({can_finish:true});speech();commit();created();event({type:"response.function_call_arguments.done",response_id:"response",call_id:"close-call",name:"request_completion"});done();await vi.advanceTimersByTimeAsync(1);
 created("closing",{feedx_kind:"tool",call_id:"close-call"});done("closing","cancelled");event({type:"output_audio_buffer.stopped",response_id:"closing"});await vi.advanceTimersByTimeAsync(0);
 expect(completion).not.toHaveBeenCalled();
});
