import { InterviewRecovery, bounded } from "./interviewRecovery.js";
import { RecruitmentRealtimeSession } from "./RecruitmentRealtimeSession.js";
import { recruitmentService } from "./recruitmentService.js";

// The generation owns the conversational runtime. React receives display state
// and terminal intent; it never schedules responses or handles provider tools.
export class InterviewTransportGeneration extends InterviewRecovery {
  begin(activate) {
    const operation=super.begin(activate); // native gesture acquisition first
    this.closeInterviewer();return operation;
  }
  async connectInterviewer({token,clientId,recoveryId,mediaStream,startedAt,audioElement,onStatus,onRemote,onRecovery,onCompletion,signal}) {
    this.closeInterviewer();
    const current = () => this.transport === transport && !transport.closed;
    const assess = () => {
      if (this.assessment) return this.assessment;
      const pending = (async()=>{
        await bounded(transport.flush(), "Saving interview answers", {signal,timeoutMs:8000});
        // Existing server coverage cadence is ten seconds. Reuse its latest
        // canonical result during that window; no speech is delayed for the check.
        const cached = this.lastAssessment && Date.now()-this.lastAssessmentAt<10000;
        const result = cached ? this.lastAssessment :
          await bounded(recruitmentService.evidence("coverage",token,clientId,{},signal), "Checking interview evidence", {signal,timeoutMs:35000});
        if(current() && !cached) {this.lastAssessment=result;this.lastAssessmentAt=Date.now();}
        if (current()) await bounded(transport.refreshContext(signal), "Updating interviewer context", {signal,timeoutMs:10000});
        return result;
      })().finally(()=>{if(this.assessment===pending)this.assessment=null;});
      this.assessment=pending;return pending;
    };
    const transport = new RecruitmentRealtimeSession({token,clientId,recoveryId,mediaStream,startedAt,audioElement,
      onRemote:stream=>{if(current())onRemote(stream);},
      onStatus:state=>{
        if (!current()) return;
        onStatus(state);
        if (["disconnected","audio-blocked"].includes(state)) onRecovery(state);
      },
      onTool:async()=>{
        const result = await assess();
        if (!current()) throw Error("Interview was replaced.");
        this.completion = result?.can_finish ? result : null;
        return result || {can_finish:false,reason:"Continue collecting missing evidence."};
      },
      onCompletion:()=>{
        if(current() && this.completion) onCompletion(this.completion.max_reached ? "max_duration" : "coverage");
      },
      onEvent:event=>{
        if (!current()) return;
        if(event.type === "input_audio_buffer.speech_started") this.completion=null;
        if(event.type === "conversation.item.input_audio_transcription.completed") {
          // Coalesce server coverage work, independently of provider turn progress.
          this.refreshCoverage ||= setTimeout(async()=>{
            this.refreshCoverage=null;
            if(!current())return;
            try {await assess();} catch { /* Next answer/tool retries; provider speech continues. */ }
          },1000);
        }
      },
    });
    this.transport=transport;
    this.assess=assess;
    await bounded(transport.connect({signal}), "AI connection", {signal,timeoutMs:25000});
    if (!current()) throw Error("Interview was replaced.");
    return transport;
  }
  closeInterviewer() {
    clearTimeout(this.refreshCoverage);this.refreshCoverage=null;
    this.transport?.close();this.transport=null;this.completion=null;this.assessment=null;this.lastAssessment=null;
  }
  cancel() { this.closeInterviewer(); super.cancel(); }
}
