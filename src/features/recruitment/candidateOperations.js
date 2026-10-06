import { formatOperationalMoment } from "../../lib/dateTime.js";
export const preferenceLabels = { unknown: "Unknown", full_time: "Full Time", part_time: "Part Time", both: "Both" };
export const formatRecruitmentTime = formatOperationalMoment;
export function interviewStateLabel(state) {
  if (["completed", "partial"].includes(state)) return "Completed";
  if (state === "failed") return "Incomplete";
  if (state === "finalizing") return "Finalizing";
  return ["starting", "interviewing", "interrupted", "concluding"].includes(state) ? (state === "interrupted" ? "Interrupted" : "In progress") : "Not started";
}
export function candidateTimeline(data) {
  const app = data.application || {}, attempt = data.attempt || {};
  const entries = [];
  const add = (key,label,at,detail) => { if (at) entries.push({key,label,at,detail}); };
  add("registered", "Registered", app.created_at);
  const events = data.lifecycle_events || [];
  let invitations = 0;
  for (const event of events) {
    if (event.action === "application_registered") continue;
    if (["interview_started","interview_finalized"].includes(event.action) && event.attempt_id === attempt.id) continue;
    const labels = {invitation_issued:"Invited",invitation_revoked:"Invitation revoked",recording_gap:"Interview interrupted · recording gap",manager_decision:"Manager decision",employment_preference_changed:"Offering preference updated",interview_started:"Earlier interview started",interview_finalized:"Earlier interview saved"};
    const label = event.action === "invitation_issued" ? (++invitations > 1 ? "Invitation reissued" : "Invited") : labels[event.action];
    if (label) add(`event-${event.id}`,label,event.occurred_at,event.action === "employment_preference_changed" ? preferenceLabels[event.details?.to] : event.action === "manager_decision" ? (event.details?.to || event.details?.decision || event.details?.to_state)?.replaceAll("_"," ") : undefined);
  }
  // Canonical attempt timestamps, not UI events. Selected attempt is explicit.
  add("started", "Interview started", attempt.interview_started_at);
  add("completed", "Interview completed", attempt.interview_ended_at, ["partial","failed"].includes(attempt.status) ? `${attempt.status} evidence` : undefined);
  const ready = events.find(e=>e.action === "interview_finalized" && e.attempt_id === attempt.id);
  add("review-ready", "Ready for review", ready?.occurred_at);
  add("reviewed", "Report reviewed", data.reviewed_at);
  return entries.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
}
