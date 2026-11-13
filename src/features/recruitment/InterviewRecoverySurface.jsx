import { AlertCircle, ArrowRight, Clock } from "lucide-react";
import { candidateText } from "./candidatePreparation.js";
import { Component } from "react";

// Recovery never mounts the old preview, animated Room or provider media nodes.
export function InterviewRecoverySurface({ entry, recovering, status, hasConnected, language, children }) {
  const t = candidateText(language);
  const submitting = status === "finalizing";
  const retrySubmission = status === "submission_required";
  const busy = submitting || recovering;
  const title = submitting ? t.submitting : retrySubmission ? t.submitFailed
    : recovering ? (hasConnected ? t.continuing : t.starting)
    : hasConnected ? t.interrupted : t.startFailed;
  const help = submitting ? t.submittingHelp : retrySubmission ? t.submitHelp
    : recovering ? null : hasConnected ? t.resumeHelp : t.startHelp;
  const Icon = busy ? Clock : retrySubmission ? AlertCircle : ArrowRight;
  return (
    <section className="candidate-recovery" data-testid="interview-recovery-surface" aria-busy={busy}>
      <span className="candidate-state-icon" aria-hidden="true"><Icon size={24} /></span>
      <div aria-live="polite"><h1>{title}</h1></div>
      {help && <p>{help}</p>}
      {entry.job && <p className="recruitment-hint">{entry.job.position || entry.job.title}{entry.job.workplace && ` · ${entry.job.workplace}`}</p>}
      <div className="candidate-recovery-actions">{children}</div>
    </section>
  );
}
export class InterviewRoomBoundary extends Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.controller.observe("recovery.error",{stage:"room.render",code:"render_failed",request_id:this.props.controller.recoveryId});this.props.controller.pause("room_render_failed");}
  componentDidMount(){if(this.props.active)this.props.controller.observe("recovery.command",{stage:"room.mounted",request_id:this.props.controller.recoveryId});}
  render(){return this.state.failed?null:this.props.children;}
}
