import {describe,it,expect} from 'vitest';
import {adsReadiness,adsReportingPeriod} from '../adsReadiness.js';
const account={status:'test_authorized',expires_at:'2027-01-01',health:{read_verified:true}};
describe('Ads reporting readiness',()=>{
 it('uses provider-local dates at a cross-timezone day boundary',()=>{
  const now=new Date('2026-10-13T00:30:00Z');
  expect(adsReportingPeriod('America/New_York',30,now)).toEqual({from:'2026-09-13',to:'2026-10-12'});
  expect(adsReportingPeriod('Asia/Singapore',30,now)).toEqual({from:'2026-09-14',to:'2026-10-13'});
  expect(adsReportingPeriod('unknown')).toBeNull();
 });
 it('distinguishes authorization from synchronized reporting, including empty periods',()=>{
  expect(adsReadiness(account).label).toBe('Connected');
  expect(adsReadiness(account,{insights:{account:[]},warnings:{}}).label).toBe('Ready');
  expect(adsReadiness(account,{warnings:{ad:'meta_permission_or_token_invalid'}}).label).toBe('Needs Attention');
 });
 it('shows initial progress and does not call for OAuth on a transient reporting failure',()=>{
  const state=adsReadiness({...account,health:{sync_error:'meta_error_429'},sync:{active_jobs:1,initial_total:2,initial_completed:1}});
  expect(state.label).toBe('Syncing');expect(state.reason).toContain('1/2');expect(state.reconnect).toBeUndefined();
 });
 it('makes revoked reporting and expired grants actionable independently of report existence',()=>{
  expect(adsReadiness({...account,health:{sync_error:'ads_read_not_granted'}},{}).reconnect).toBe(true);
  expect(adsReadiness({...account,expires_at:'2025-01-01'},{}).label).toBe('Needs Attention');
 });
 it('surfaces shared worker and terminal lease failures without claiming ready',()=>{
  expect(adsReadiness({...account,sync:{worker_available:false}},{}).reason).toContain('shared service');
  expect(adsReadiness({...account,sync:{latest_job:{state:'failed',error_code:'sync_retry_limit'}}},{}).label).toBe('Needs Attention');
 });
});
