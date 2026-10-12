import {describe,it,expect} from 'vitest';
import {socialCapabilities,socialAccountIssues,socialStateLabel} from '../socialAccountHealth.js';
const connected={status:'test_authorized',expires_at:'2099-01-01',capabilities:{publishing:true,insights:true}};
describe('independent Meta capability states',()=>{
 it('does not imply delivery from OAuth or configuration',()=>{
  expect(socialCapabilities(connected).messaging.state).toBe('connected');
  expect(socialCapabilities({...connected,messaging:{configuration_verified:true,receiving_verified:true}}).messaging.state).toBe('awaiting_first_delivery');
 });
 it('requires current receiving authority for delivery readiness',()=>{
  expect(socialCapabilities({...connected,messaging:{delivery_verified:true,receiving_verified:true}}).messaging.state).toBe('delivery_verified');
  expect(socialCapabilities({...connected,messaging:{delivery_verified:true,receiving_verified:false}}).messaging.state).toBe('connected');
  expect(socialCapabilities({...connected,status:'expired',messaging:{configuration_verified:true,delivery_verified:true}}).messaging.reason).toBe('reconnect');
 });
 it('offers action only for actionable failures, without treating first delivery as an issue',()=>{
  expect(socialAccountIssues({...connected,messaging:{configuration_verified:true}})).toEqual([]);
  expect(socialAccountIssues({...connected,checks:{error_code:'meta_temporarily_unavailable'}})).toEqual([]);
  expect(socialAccountIssues({...connected,health:{messaging:{state:'permission_required',reason:'permission_missing'}}})).toHaveLength(1);
  expect(socialStateLabel('connected')).toBe('OAuth Connected');
 });
});
