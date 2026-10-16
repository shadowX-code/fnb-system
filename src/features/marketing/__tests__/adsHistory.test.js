import {adsReportingPeriod} from '../adsReadiness.js';
import {describe,it,expect} from 'vitest';
import {historyFloor,campaignLifetime,adsCoverage,adsMetricAvailability,observedLifetime} from '../adsHistory.js';
describe('canonical historical presentation',()=>{
 it('uses twelve calendar months including leap-day boundaries in account timezone',()=>{expect(adsReportingPeriod('Asia/Singapore',365,new Date('2024-02-29T00:00:00Z'))).toEqual({from:'2023-03-01',to:'2024-02-29'});});
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
  expect(adsMetricAvailability({not_synced:true},'campaign',null)).toBe('Selected period not synced');
  expect(adsMetricAvailability({warnings:{campaign:'meta_error_100'}},'campaign',null)).toBe('Provider unavailable');
  expect(adsMetricAvailability({warnings:{}},'campaign',null)).toBe('No campaign Insight returned · activity not established');
  expect(adsMetricAvailability({warnings:{}},'campaign',{metrics:{spend:{value:0}}})).toBeNull();
 });
});

it('recognizes broader and overlapping imports without reusing incompatible aggregate metrics',()=>{
 const coverage=[{connection_id:'a',ranges:[{from:'2025-10-17',to:'2026-10-16'}]}];
 const h=adsCoverage({coverage},'a','2026-04-20','2026-07-18');
 expect(h.periodEvidence).toBe('broader');expect(h.report).toBeUndefined();expect(h.state).toBe('not_synced');
 expect(adsCoverage({coverage},'a','2025-01-01','2026-04-20').periodEvidence).toBe('overlap');
 expect(adsCoverage({coverage},'b','2026-04-20','2026-07-18').periodEvidence).toBe('none');
 expect(adsCoverage({coverage,reports:[{connection_id:'a',date_from:'2026-04-20',date_to:'2026-07-18',payload:{warnings:{campaign:'denied'}}}]},'a','2026-04-20','2026-07-18').periodEvidence).toBe('exact');
});

it('chooses one widest actual report for Lifetime Performance without combining snapshots',()=>{
 const data={coverage:[{connection_id:'supreme',ranges:[{from:'2025-10-17',to:'2026-10-16'},{from:'2023-09-16',to:'2026-10-16'},{from:'2023-09-16',to:'2025-10-16'}]}]};
 expect(observedLifetime(data,'supreme')).toEqual({from:'2023-09-16',to:'2026-10-16'});
 expect(observedLifetime(data,'foreign')).toBeNull();
});
