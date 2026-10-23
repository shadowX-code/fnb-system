import {scheduleInstant} from './marketingCalendar.js';
import {CONTENT_TIMEZONE} from './contentManagement.js';
export const publishingIntent=payload=>['draft','now','schedule'].includes(payload?.publishing_plan)?payload.publishing_plan:payload?.publishing_plan==='after_approval'?'now':payload?.planned_at?'schedule':'draft';
export function publishingPlanPayload(payload,local){
 const intent=publishingIntent(payload);
 if(intent==='schedule'){
  const planned=local===undefined?payload.planned_at:local?scheduleInstant(local,CONTENT_TIMEZONE):null;
  if(!planned||!Number.isFinite(Date.parse(planned))||Date.parse(planned)<=Date.now())throw new Error('Choose a valid future publishing date and time, or select Save Draft.');
  return {...payload,planned_at:planned,planned_timezone:CONTENT_TIMEZONE};
 }
 // Legacy payloads keep their established evidence unless staff explicitly change the plan.
 return payload.publishing_plan?{...payload,planned_at:null,planned_timezone:CONTENT_TIMEZONE}:payload;
}
export function publishingStatus(content){
 const status=content?.status||'draft';
 if(status==='review')return {label:'Review',next:'An authorized reviewer must approve this revision.'};
 if(status==='approved')return {label:'Ready to Publish',next:'Choose Publish Now or Schedule, then confirm the exact revision and eligible accounts.'};
 if(status==='scheduled')return {label:'Scheduled',next:content.channels?.some(c=>c.job_state==='blocked')?'Confirm external publishing authorization for the pending channels.':'Delivery follows each channel’s saved schedule and execution safeguards.'};
 if(status==='draft'||status==='rejected')return {label:status==='draft'?'Draft':'Revision Needed',next:'Save the content, then submit it for approval. The publishing plan does not send.'};
 return {label:status.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase()),next:''};
}
