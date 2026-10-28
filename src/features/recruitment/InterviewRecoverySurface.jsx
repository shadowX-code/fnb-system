import { Component } from "react";

// Recovery never mounts the old preview, animated Room or provider media nodes.
export function InterviewRecoverySurface({entry,recovering,status,children}) {
  return <section className="candidate-recovery" data-testid="interview-recovery-surface">
    <p>{entry.job?.position||entry.job?.title||"Interview"} · {entry.job?.workplace}</p>
    <h1>{status==="finalizing"?"Submitting your responses":recovering?"Preparing to continue":"Ready to continue"}</h1>
    {status!=="finalizing"&&<p>Your saved answers are retained. Continuing starts a fresh camera, microphone and interviewer connection. Recording gaps remain visible to the hiring team.</p>}
    <div className="candidate-recovery-actions">{children}</div>
  </section>;
}
export class InterviewRoomBoundary extends Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.controller.observe("recovery.error",{stage:"room.render",code:"render_failed",request_id:this.props.controller.recoveryId});this.props.controller.pause("room_render_failed");}
  componentDidMount(){if(this.props.active)this.props.controller.observe("recovery.command",{stage:"room.mounted",request_id:this.props.controller.recoveryId});}
  render(){return this.state.failed?null:this.props.children;}
}
