import hrManifest from '../../../config/hrAgentActions.json';
import factoryManifest from '../../../config/factoryAgentActions.json';
import restaurantManifest from '../../../config/restaurantAgentActions.json';
const manifest=[...factoryManifest,...restaurantManifest,...hrManifest];

const readTools = new Set(['query_hr_resources','query_product_sales_analytics','query_restaurant_resources','query_factory_resources','query_mesti_resources','get_mesti_daily_status','list_mesti_exceptions','list_pending_verifications','get_mesti_evidence_details','get_mesti_requirement_schedule']);
const legacyReads = {get_mesti_daily_status:'Read daily MeSTI status',list_mesti_exceptions:'Read MeSTI exceptions',list_pending_verifications:'Read pending verifications',get_mesti_evidence_details:'Read MeSTI evidence',get_mesti_requirement_schedule:'Read MeSTI schedule'};
const past = {shortlist:'shortlisted',advance:'advanced',reject:'rejected',reverse:'reversed',create:'created',update:'updated',submit:'submitted',complete:'completed',verify:'verified',approve:'approved',cancel:'cancelled',confirm:'confirmed',receive:'received',return_to_draft:'returned to draft'};
const impact = {shortlist:'Candidate shortlisted',advance:'Candidate advanced to final interview',reject:'Candidate rejected',reverse:'Audited reversal appended',create:'Record created',update:'Record updated',submit:'Record submitted',complete:'Completion recorded',verify:'Verification recorded',approve:'Approval recorded',cancel:'Record cancelled',confirm:'Supplier confirmation recorded',receive:'Canonical receiving and stock movement recorded',return_to_draft:'Record returned to draft'};
export const activityFailureLabels = {credential_denied:'Access key or connection permission was not accepted.',capability_denied:'This capability is not allowed.',tool_denied:'The requested capability is unavailable.',evidence_unavailable:'The requested evidence or execution result was unavailable.',invalid_request:'The request could not be processed.',origin_denied:'Unsupported application origin.',unsupported_version:'Unsupported connection version.',method_denied:'Unsupported connection method.'};

// A display projection of existing authorized responses, never a new operation/audit authority.
export function agentActivity(detail, requests = [], identityId) {
 const operations = new Map();
 for (const row of requests) {
  if (!row.request_id || row.identity_id !== identityId) continue;
  const definition = manifest.find(action => action.key === row.action), receipt = row.receipt;
  const committed = row.status === 'completed' && receipt?.status === 'completed' && receipt.request_id === row.request_id && receipt.action === row.action && receipt.actor?.identity_id === identityId && (row.expected_version ?? null) === (receipt.before_version ?? null);
  const state = committed ? 'committed' : row.status === 'completed' ? 'unproven' : row.queue_state || 'unproven';
  const verb = row.action === 'job_order.submit' ? 'released' : past[definition?.action] || 'changed';
  const title = committed ? `${definition?.label || row.label || 'Factory record'} ${verb}` : `${definition?.label || row.label || 'Factory record'} · ${definition?.action || 'Action'}`;
  const key = JSON.stringify([identityId,row.request_id,row.action,row.target_id,row.expected_version,row.input,receipt?.target_id]);
  const entry = {id:`operation:${row.request_id}:${operations.size}`,date:receipt?.completed_at||row.confirmed_at||row.requested_at,category:'changes',state,title,
   moduleIds:definition?[definition.module]:[],target:committed?receipt.target_id||row.target_id:row.target_id,
   impact:committed?(row.action==='job_order.submit'?'Job Order released':impact[definition?.action]||'Canonical operation committed'):row.resolution_reason||'No completed business result is established by this request.',
   diagnostics:[{request:row}],evidenceVisible:row.input!==undefined};
  if (operations.has(key)) operations.get(key).diagnostics.push(...entry.diagnostics);
  else operations.set(key,entry);
 }
 const events = [...operations.values()], diagnostics = [];
 for (const row of detail.access_events || []) {
  const modules = [...new Set((row.resource_actions || []).map(action=>action.business_module).filter(Boolean))];
  const read = readTools.has(row.tool), failed = row.outcome==='failed'||row.outcome==='denied';
  const entry = {id:`access:${row.id}`,date:row.occurred_at,category:failed?'failed':'read',state:row.outcome==='denied'?'denied':row.outcome==='failed'?'failed':'read',moduleIds:modules,
   title:read?(legacyReads[row.tool]||(row.tool==='query_hr_resources'?'Read HR records':row.tool==='query_product_sales_analytics'?'Read Product Sales Analytics':row.tool==='query_restaurant_resources'?'Read Restaurant records':'Read Factory records')):['execute_factory_action','execute_restaurant_action','execute_hr_action'].includes(row.tool)?'Business action attempt':['factory_action_context','restaurant_action_context','hr_action_context'].includes(row.tool)?'Business action eligibility':'Connection request',
   impact:failed?(activityFailureLabels[row.failure_reason]||'Request unsuccessful; a committed result is not established by this event.'):'Record information returned. Historical result count and target references were not recorded.',
   diagnostics:[{access_event_id:row.id,method:row.method,tool:row.tool,outcome:row.outcome,failure_reason:row.failure_reason,source:row.source,resource_actions:row.resource_actions,correlation:'No recorded operation ID; not correlated by timestamp.'}]};
  if (row.source==='admin_probe' || (!read && !failed)) {
   diagnostics.push({...entry,category:'diagnostics',state:failed?entry.state:['execute_factory_action','execute_restaurant_action','execute_hr_action'].includes(row.tool)?'accepted':['factory_action_context','restaurant_action_context','hr_action_context'].includes(row.tool)?'checked':'connection',
    title:row.source==='admin_probe'?'FeedX connection check':['execute_factory_action','execute_restaurant_action','execute_hr_action'].includes(row.tool)?'API accepted request':['factory_action_context','restaurant_action_context','hr_action_context'].includes(row.tool)?'Action eligibility checked':'Connection check',impact:'Technical observation only; it does not establish a completed business operation.'});
  } else events.push(entry);
 }
 for (const row of detail.management_events || []) events.push({id:`audit:${row.id}`,date:row.occurred_at,category:'changes',state:'configuration_changed',moduleIds:['ai_integrations'],title:row.label||'Agent configuration changed',impact:'Administrator configuration change recorded.',diagnostics:[{audit_id:row.id,action:row.action,occurred_at:row.occurred_at}]});
 const sort=(a,b)=>Date.parse(b.date)-Date.parse(a.date)||a.id.localeCompare(b.id);
 return {events:events.sort(sort),diagnostics:diagnostics.sort(sort)};
}
