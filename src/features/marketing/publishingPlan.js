import {scheduleInstant} from './marketingCalendar.js';
import {CONTENT_TIMEZONE} from './contentManagement.js';
export const publishingIntent=payload=>['draft','after_approval','schedule'].includes(payload?.publishing_plan)?payload.publishing_plan:payload?.planned_at?'schedule':'draft';
export function publishingPlanPayload(payload,local){
 const intent=publishingIntent(payload);
 if(intent==='schedule'){
  const planned=local===undefined?payload.planned_at:local?scheduleInstant(local,CONTENT_TIMEZONE):null;
  if(!planned)throw new Error('Choose a publishing date and time, or select Save as Draft.');
  return {...payload,planned_at:planned,planned_timezone:CONTENT_TIMEZONE};
 }
 // Legacy payloads keep their established evidence unless staff explicitly change the plan.
 return payload.publishing_plan?{...payload,planned_at:null,planned_timezone:CONTENT_TIMEZONE}:payload;
}
export function publishingStatus(content){
 const status=content?.status||'draft';
 if(status==='review')return {label:'Awaiting Approval',next:'An authorized reviewer must approve this revision.'};
 if(status==='approved')return {label:'Ready to Publish',next:'Confirm the publishing time, then authorize the exact revision and accounts. Approval alone does not send.'};
 if(status==='scheduled')return {label:'Scheduled',next:content.channels?.some(c=>c.job_state==='blocked')?'Confirm external publishing authorization for the pending channels.':'Delivery follows each channel’s saved schedule and execution safeguards.'};
 if(status==='draft'||status==='rejected')return {label:status==='draft'?'Draft':'Revision Needed',next:'Save the content, then submit it for approval. The publishing plan does not send.'};
 return {label:status.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase()),next:''};
}
