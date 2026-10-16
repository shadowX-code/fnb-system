import {describe,it,expect,vi} from 'vitest';
import {readAdsHistoryStep} from '../../../../supabase/functions/_shared/metaAds.ts';
import {MetaError} from '../../../../supabase/functions/_shared/metaGraph.ts';
const account={id:'123',currency:'MYR',timezone:'Asia/Singapore'};
const row={account_id:'123',account_currency:'MYR',date_start:'2025-10-17',date_stop:'2026-10-16',spend:'0',reach:'17',clicks:'0',impressions:'5'};
const guard=async()=>{};
describe('bounded resumable exact-period reports',()=>{
 it('checkpoints three pages and resumes without re-fetching them; only daily windows split',async()=>{
  const calls:any[]=[];
  const graph:any={request:vi.fn(async(path,token,params)=>{calls.push({path,params});return {data:path.endsWith('insights')?[{...row,...(params.time_increment?{date_start:params.time_range.since,date_stop:params.time_range.since}:{})}]:[]};})};
  let result=await readAdsHistoryStep(graph,account,'secret','2025-10-17','2026-10-16',{},guard);
  expect(graph.request).toHaveBeenCalledTimes(3);expect(result.complete).toBe(false);expect(result.state.step).toBe(3);
  for(let ticks=0;!result.complete&&ticks<20;ticks++)result=await readAdsHistoryStep(graph,account,'secret','2025-10-17','2026-10-16',result.state,guard);
  expect(result.complete).toBe(true);
  expect(calls.filter(c=>c.path.endsWith('/campaigns'))).toHaveLength(1);
  const totals=calls.filter(c=>c.path.endsWith('insights')&&!c.params.time_increment);
  expect(totals).toHaveLength(4);expect(totals.every(c=>c.params.time_range.since==='2025-10-17'&&c.params.time_range.until==='2026-10-16')).toBe(true);
  const daily=calls.filter(c=>c.params.time_increment);
  expect(daily).toHaveLength(5);
  for(let i=1;i<daily.length;i++)expect(Date.parse(daily[i].params.time_range.since)-Date.parse(daily[i-1].params.time_range.until)).toBe(86400000);
  expect(result.state.report.insights.account[0].metrics.spend.value).toBe(0);
  expect(result.state.report.insights.account[0].metrics.reach.value).toBe(17);
 });
 it('persists provider cursors, deduplicates repeated rows and rejects changing overlap',async()=>{
  const saved:any={step:3,page:0,requests:3,window:'2025-10-17',report:{account,configs:{},insights:{},warnings:{}}};
  const graph:any={request:vi.fn(async()=>({data:[row],paging:{next:'https://provider/next',cursors:{after:'cursor'}}}))};
  const r=await readAdsHistoryStep(graph,account,'secret','2025-10-17','2026-10-16',saved,guard);
  expect(r.state.report.warnings.account).toBe('ads_pagination_unavailable');expect(r.state.report.insights.account).toEqual([]);
  expect(saved.requests).toBe(3); // caller's durable checkpoint remains unchanged on failure
 });
 it('does not turn revoked authority or temporary failure into an empty completed report',async()=>{
  const graph:any={request:vi.fn(async()=>{throw new MetaError('meta_permission_or_token_invalid')})};
  await expect(readAdsHistoryStep(graph,account,'secret','2025-10-17','2026-10-16',{},guard)).rejects.toMatchObject({code:'meta_permission_or_token_invalid'});
  const saved={step:3,requests:3,report:{account,configs:{},insights:{},warnings:{}}};
  graph.request.mockImplementation(async()=>{throw new MetaError('meta_error_4',false,true)});
  await expect(readAdsHistoryStep(graph,account,'secret','2025-10-17','2026-10-16',saved,guard)).rejects.toMatchObject({code:'meta_error_4'});
 });
 it('records unavailable historical metrics without publishing a partial level',async()=>{
  const graph:any={request:vi.fn(async()=>{throw new MetaError('meta_error_100')})};
  const saved={step:3,requests:3,report:{account,configs:{},insights:{},warnings:{}}};
  const result=await readAdsHistoryStep(graph,account,'secret','2025-10-17','2026-10-16',saved,guard);
  expect(result.state.report.warnings.account).toBe('meta_error_100');expect(result.state.report.insights.account).toEqual([]);
 });
});
describe('historical field-specific provider rejection',()=>{
 it('retries once without Reach and retains exact-period core spend, never inventing Reach',async()=>{
  const graph:any={version:'v25.0',request:vi.fn(async(path,token,p)=>{
   if(p.fields.split(',').includes('reach'))throw new MetaError('meta_error_100',false,false,100);
   return {data:[{...row,reach:undefined}]};
  })};
  const saved={step:3,page:0,requests:3,window:'2025-10-17',report:{account,configs:{},insights:{},warnings:{}}};
  const r=await readAdsHistoryStep(graph,account,'secret','2025-10-17','2026-10-16',saved,guard);
  expect(r.state.report.insights.account[0].metrics.spend.value).toBe(0);
  expect(r.state.report.insights.account[0].metrics.reach.value).toBeNull();
  expect(r.state.report.metric_warnings.account.reach).toContain('succeeded');
  expect(graph.request).toHaveBeenCalledTimes(3);
 });
});

describe('history turn deadline',()=>{
 it('checkpoints successful pages before a slow turn expires, without masking revoked authority',async()=>{
  const graph:any={request:vi.fn(async()=>({data:[]}))};let checks=0;
  const result=await readAdsHistoryStep(graph,account,'secret','2025-10-17','2026-10-16',{},async()=>{if(++checks>1)throw new MetaError('ads_sync_time_limit')});
  expect(result.complete).toBe(false);expect(result.state.requests).toBe(1);expect(result.state.step).toBe(1);
  let revoked=0;
  await expect(readAdsHistoryStep(graph,account,'secret','2025-10-17','2026-10-16',{},async()=>{if(++revoked>1)throw new MetaError('ads_authority_changed')})).rejects.toMatchObject({code:'ads_authority_changed'});
 });
});

describe('database checkpoint JSON ordering',()=>{
 it('deduplicates the same provider row after JSONB reorders its saved keys',async()=>{
  const {adsInsight}=await import('../../../../supabase/functions/_shared/metaAds.ts');
  const ordered=(_key:string,v:any)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v;
  const original=JSON.parse(JSON.stringify(adsInsight(row),ordered));
  const saved={step:3,page:1,after:'first',requests:4,window:'2025-10-17',report:{account,configs:{},insights:{account:[original]},warnings:{}}};
  const graph:any={request:vi.fn(async()=>({data:[row]}))};
  const result=await readAdsHistoryStep(graph,account,'secret','2025-10-17','2026-10-16',saved,guard);
  expect(result.state.report.insights.account).toHaveLength(1);
  expect(result.state.report.warnings.account).toBeUndefined();
 });
});

describe('restricted daily windows',()=>{
 it('keeps a denied old window as a gap and still reads eligible newer daily observations',async()=>{
  const graph:any={request:vi.fn(async(_path,_token,p)=>{if(p.time_range.since==='2025-10-17')throw new MetaError('meta_error_100');return {data:[{...row,date_start:p.time_range.since,date_stop:p.time_range.since}]};})};
  const saved={step:7,page:0,requests:7,window:'2025-10-17',report:{account,configs:{},insights:{},warnings:{}}};
  const r=await readAdsHistoryStep(graph,account,'secret','2025-10-17','2026-04-14',saved,guard);
  expect(r.complete).toBe(true);expect(r.state.report.daily_gaps).toEqual([{from:'2025-10-17',to:'2026-01-14',reason:'meta_error_100'}]);
  expect(r.state.report.insights.daily).toHaveLength(1);expect(r.state.report.insights.daily[0].date_start).toBe('2026-01-15');
 });
});
