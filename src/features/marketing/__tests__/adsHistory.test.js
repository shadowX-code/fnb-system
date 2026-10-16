import {describe,it,expect} from 'vitest';
import {historyFloor,campaignLifetime,adsCoverage,adsMetricAvailability} from '../adsHistory.js';
describe('canonical historical presentation',()=>{
 it('clamps calendar month ends and campaign lifetime to the requested history window',()=>{
  expect(historyFloor('2026-03-31')).toBe('2023-02-28');
  expect(campaignLifetime({start_time:'2020-01-01T00:00:00+0800'},'2026-10-16')).toEqual({from:'2023-09-16',to:'2026-10-16',limited:true});
  expect(campaignLifetime({start_time:'2026-01-01',stop_time:'2026-02-01'},'2026-10-16')).toEqual({from:'2026-01-01',to:'2026-02-01',limited:false});
 });
 it('does not treat overlapping stored periods as a complete selected snapshot',()=>{
  const data={reports:[{connection_id:'a',date_from:'2026-01-01',date_to:'2026-01-30'}],coverage:[{connection_id:'a',ranges:[{from:'2026-01-01',to:'2026-01-30'}]}]};
  expect(adsCoverage(data,'a','2026-01-01','2026-12-31').state).toBe('not_synced');
  expect(adsCoverage(data,'a','2026-01-01','2026-01-30').state).toBe('observed');
 });
 it('keeps unsynced, no returned activity, provider errors and actual zero distinct',()=>{
  expect(adsMetricAvailability({not_synced:true},'campaign',null)).toBe('Not yet synced');
  expect(adsMetricAvailability({warnings:{campaign:'meta_error_100'}},'campaign',null)).toBe('Provider unavailable');
  expect(adsMetricAvailability({warnings:{}},'campaign',null)).toBe('No activity reported');
  expect(adsMetricAvailability({warnings:{}},'campaign',{metrics:{spend:{value:0}}})).toBeNull();
 });
});
