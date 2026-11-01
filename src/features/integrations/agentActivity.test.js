import {it,expect} from 'vitest';
import {agentActivity} from './agentActivity.js';
import {operationalDateKey} from '../../lib/dateTime.js';
const stamp='2026-11-01T08:00:00Z';
const completed={identity_id:'agent',request_id:'request',action:'area_cleaning.complete',status:'completed',requested_at:stamp,expected_version:'source',target_id:'record',input:{note:'Original evidence'},receipt:{status:'completed',action:'area_cleaning.complete',request_id:'request',actor:{identity_id:'agent'},before_version:'source',target_id:'record',completed_at:stamp}};
it('renders one receipt-backed operation for identical retries and retains every supplied diagnostic',()=>{
 const result=agentActivity({},[completed,{...completed}],'agent');
 expect(result.events).toHaveLength(1);expect(result.events[0]).toMatchObject({state:'committed',title:'Area Cleaning completed',target:'record',evidenceVisible:true});
 expect(result.events[0].diagnostics).toHaveLength(2);
});
it('never merges different intents, sources, requests or same-time reads',()=>{
 const detail={access_events:[{id:1,tool:'query_factory_resources',occurred_at:stamp,outcome:'success'},{id:2,tool:'query_factory_resources',occurred_at:stamp,outcome:'success'}]};
 const result=agentActivity(detail,[completed,{...completed,input:{note:'Different intent'}},{...completed,expected_version:'new-source'},{...completed,request_id:'different'}],'agent');
 expect(result.events).toHaveLength(6);expect(new Set(result.events.map(row=>row.id)).size).toBe(6);
});
it('requires matching canonical receipt identity/action/source before calling anything completed',()=>{
 for(const change of [{receipt:null},{receipt:{...completed.receipt,status:'awaiting_confirmation'}},{receipt:{...completed.receipt,actor:{identity_id:'other'}}},{receipt:{...completed.receipt,before_version:'changed'}},{receipt:{...completed.receipt,request_id:'different'}},{receipt:{...completed.receipt,action:'area_cleaning.verify'}}]) {
  expect(agentActivity({},[{...completed,...change}],'agent').events[0].state).toBe('unproven');
 }
 expect(agentActivity({},[{...completed,status:'awaiting_confirmation',queue_state:'pending_approval',receipt:null}],'agent').events[0].state).toBe('pending_approval');
});
it('keeps API acceptance/eligibility uncorrelated and separates denied attempts from commits',()=>{
 const result=agentActivity({access_events:[{id:1,tool:'execute_factory_action',outcome:'success',occurred_at:stamp},{id:2,tool:'factory_action_context',outcome:'success',occurred_at:stamp},{id:3,tool:'execute_factory_action',outcome:'denied',failure_reason:'capability_denied',occurred_at:stamp}]},[completed],'agent');
 expect(result.events).toHaveLength(2);expect(result.events.find(row=>row.category==='failed').state).toBe('denied');
 expect(result.diagnostics.map(row=>row.state)).toEqual(['accepted','checked']);
 expect(result.diagnostics.every(row=>row.diagnostics[0].correlation.includes('not correlated by timestamp'))).toBe(true);
});
it('preserves standalone configuration and legacy reads without inventing targets or counts',()=>{
 const result=agentActivity({management_events:[{id:9,label:'Access removed',occurred_at:stamp}],access_events:[{id:1,tool:'get_mesti_daily_status',outcome:'success',occurred_at:stamp}]},[],'agent');
 expect(result.events).toHaveLength(2);expect(result.events.find(row=>row.category==='read')).toMatchObject({title:'Read daily MeSTI status',state:'read'});
 expect(result.events.find(row=>row.category==='read').target).toBeUndefined();
 expect(result.events.find(row=>row.category==='changes').state).toBe('configuration_changed');
});
it('filters dates by Malaysia business dates across UTC midnight boundaries',()=>{
 expect(operationalDateKey('2026-10-31T16:01:00Z')).toBe('2026-11-01');
 expect(operationalDateKey('2026-11-01T15:59:00Z')).toBe('2026-11-01');
 expect(operationalDateKey('invalid')).toBe('');
});

it('recognizes Restaurant receipts, reads and technical checks without inventing completion',()=>{
 const operation={...completed,action:'restaurant_purchase_order.receive',receipt:{...completed.receipt,action:'restaurant_purchase_order.receive'}};
 const result=agentActivity({access_events:[{id:10,tool:'execute_restaurant_action',outcome:'success',occurred_at:stamp},{id:11,tool:'restaurant_action_context',outcome:'success',occurred_at:stamp},{id:12,tool:'query_restaurant_resources',outcome:'success',occurred_at:stamp,resource_actions:[{business_module:'inventory_orders',action:'read'}]}]},[operation],'agent');
 expect(result.events.find(row=>row.state==='committed')).toMatchObject({title:'Purchase Order received',moduleIds:['inventory_orders'],impact:'Canonical receiving and stock movement recorded'});
 expect(result.events.find(row=>row.state==='read').title).toBe('Read Restaurant records');
 expect(result.diagnostics.map(row=>row.state)).toEqual(['accepted','checked']);
});
