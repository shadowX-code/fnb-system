import {describe,it,expect,vi} from 'vitest';
import {processAdsSync,readAdsHistoryStep,adsInsight} from '../../../../supabase/functions/_shared/metaAds.ts';
vi.mock('../../../../supabase/functions/_shared/metaSecurity.ts',async(importOriginal)=>({...await importOriginal<any>(),unseal:async()=>({token:'unit-token'}),connectionBinding:()=>''}));
const from='2023-09-16',to='2026-10-16';
const account={id:'123',currency:'MYR',timezone:'Asia/Singapore'};
const raw={account_id:'123',account_currency:'MYR',date_start:from,date_stop:from,spend:'1.23',clicks:'0'};
const report=()=>({account,date_from:from,date_to:to,configs:{},insights:{daily:[adsInsight(raw)]},warnings:{}});
const material={provider_account_id:'123',meta_user_id:'789',sealed_token:'unit-only'};
const env=(k:string)=>k==='MARKETING_META_APP_ID'?'555':'unit';
function database(progress:any,failFinish=false){
 const job={id:'job',lease:'lease',date_from:from,date_to:to,progress};let failed=false;
 const calls:any[]=[];
 const db={rpc:vi.fn(async(name:string,args:any)=>{
  calls.push({name,args});
  if(name==='marketing_ads_claim')return {data:job};
  if(name==='marketing_ads_material')return {data:material};
  if(name==='marketing_ads_checkpoint'){job.progress=structuredClone(args.p_progress);return {};}
  if(name==='marketing_ads_finish'&&failFinish&&!failed){failed=true;return {error:{code:'XX000'}};}
  return {};
 })};return {db,job,calls};
}
describe('durable Ads finalization',()=>{
 it('finalizes a completed checkpoint without unsealing or calling Meta',async()=>{
  const {db,calls}=database({step:8,requests:37,report:report()});
  const graph:any={request:vi.fn(()=>{throw Error('must not call Meta');})};
  await expect(processAdsSync(db,graph,env)).resolves.toBe(true);
  expect(graph.request).not.toHaveBeenCalled();
  expect(calls.map(c=>c.name)).toEqual(['marketing_ads_claim','marketing_ads_material','marketing_ads_finish']);
  expect(calls.at(-1).args.p_report).toEqual(report());
 });
 it('retains completed evidence across failed finalization and retries without provider requests',async()=>{
  const {db,calls,job}=database({step:8,requests:37,report:report()},true);
  const graph:any={request:vi.fn()};
  await processAdsSync(db,graph,env);
  expect(calls.at(-1).args.p_error).toBe('ads_report_finalization_failed');
  expect(job.progress.step).toBe(8);
  await processAdsSync(db,graph,env);
  expect(calls.at(-1).args.p_report).toEqual(job.progress.report);
  expect(graph.request).not.toHaveBeenCalled();
 });
 it('checkpoints the final provider page before attempting any finalization',async()=>{
  const {db,calls,job}=database({step:7,requests:36,page:0,window:'2026-08-31',report:report()});
  const graph:any={version:'v25.0',request:vi.fn(async(path:string)=>{
   if(path==='debug_token')return {data:{is_valid:true,app_id:'555',type:'USER',user_id:'789',scopes:['ads_read']}};
   const provider={id:'act_123',account_id:'123',currency:'MYR',timezone_name:'Asia/Singapore',user_tasks:['ANALYZE']};
   if(path==='me/adaccounts')return {data:[provider]};
   if(path==='act_123')return provider;
   return {data:[{...raw,date_start:'2026-10-16',date_stop:'2026-10-16'}]};
  })};
  await processAdsSync(db,graph,env);
  expect(job.progress.step).toBe(8);expect(job.progress.requests).toBe(37);
  expect(job.progress.report.insights.daily).toHaveLength(2);
  expect(job.progress.report.history.completed_at).toMatch(/^20/);
  expect(calls.at(-1).name).toBe('marketing_ads_checkpoint');
  expect(calls.some(c=>c.name==='marketing_ads_finish')).toBe(false);
  graph.request.mockClear();await processAdsSync(db,graph,env);
  expect(graph.request).not.toHaveBeenCalled();
  expect(calls.at(-1).name).toBe('marketing_ads_finish');
 });
 it('does not finalize after current database authority has been revoked',async()=>{
  const {db,calls}=database({step:8,requests:37,report:report()});
  db.rpc.mockImplementation(async(name,args)=>{calls.push({name,args});return name==='marketing_ads_claim'?{data:{id:'job',lease:'lease',progress:{step:8,report:report()}}}:name==='marketing_ads_material'?{error:{code:'42501'}}:{};});
  const graph:any={request:vi.fn()};await processAdsSync(db,graph,env);
  expect(calls.at(-1).args.p_error).toBe('ads_authority_changed');
  expect(calls.at(-1).args.p_report).toBeNull();expect(graph.request).not.toHaveBeenCalled();
 });
 it('deduplicates identical repeated rows against a packed database checkpoint',async()=>{
  const r=adsInsight(raw);const {attribution,...packed}=r;
  const saved={step:7,page:1,requests:36,window:from,report:{...report(),insights:{daily:[packed]},insight_attribution:attribution}};
  const graph:any={request:vi.fn(async()=>({data:[raw]}))};
  const next=await readAdsHistoryStep(graph,account,'unit',from,from,saved,async()=>{});
  expect(next.state.report.insights.daily).toEqual([packed]);expect(next.state.report.warnings).toEqual({});
 });
});
