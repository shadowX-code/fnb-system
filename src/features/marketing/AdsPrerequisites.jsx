import {useEffect,useRef,useState} from 'react';
import Badge from '../../components/ui/Badge.jsx';
import {adsService} from './adsService.js';

const reasons={ads_management_required:'Authorize Ads Management with the account owner.',ad_page_authorization_unverified:'Meta has not confirmed advertising access to this Brand’s Page.',page_unavailable:'Page advertising access could not be checked.',minimum_budget_unavailable:'Meta’s account-specific minimum budget is unavailable. Do not assume a budget floor.',post_unavailable:'The selected post could not be checked with this Ads credential.',ad_source_post_unverified:'Meta has not confirmed this exact post is eligible for promotion.',source_post_not_selected:'Choose an existing published post to check promotion eligibility.',advertiser_payer_verification_required:'Verify the actual advertiser and payer in Meta. Draft identity IDs are not proof of verification.'};
export default function AdsPrerequisites({org,brand,connection,page,source,accountId,managementLoginReady=false,canConnect=false}) {
 const [result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const sequence=useRef(0),pending=useRef(false);
 useEffect(()=>{sequence.current++;setResult(null);setError('');return()=>{sequence.current++;};},[org,brand,connection,page,source]);
 async function check(){if(pending.current)return;pending.current=true;const n=sequence.current;setBusy(true);setError('');try{const r=await adsService.readOnlyPreflight({organizationId:org,brandId:brand,connectionId:connection,pageId:page,sourceJobId:source||null});if(n===sequence.current)setResult(r);}catch(e){if(n===sequence.current)setError(e.message);}finally{pending.current=false;setBusy(false);}}
 async function authorize(){if(pending.current)return;pending.current=true;setBusy(true);setError('');try{const r=await adsService.authorize(org,null,'management');window.location.assign(r.authorization_url);}catch(e){setError(e.message);}finally{pending.current=false;setBusy(false);}}
 return <section className="ads-panel space-y-3" aria-label="Ads prerequisites">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-sm">Meta readiness</h3><Badge tone="warning">Not authorized to create or spend</Badge></div>
  <p className="text-xs text-text-secondary">Check the current Ads credential, Brand Page, selected post and minimum budget. These reads never create an ad.</p>
  <div className="flex flex-wrap gap-2"><button className="btn-secondary" type="button" disabled={busy||!org||!brand||!connection||!page} onClick={check}>{busy?'Checking…':'Check Meta access'}</button>
   {canConnect?<button className="btn-secondary" type="button" disabled={busy||!managementLoginReady} title={!managementLoginReady?'An administrator must configure the dedicated Ads Management login first.':undefined} onClick={authorize}>Authorize Ads Management</button>:null}
  </div>
  {!managementLoginReady?<p className="text-xs text-text-secondary">Dedicated Ads authorization setup is pending. Reporting and Publishing login are unchanged.</p>:null}
  {error?<p role="alert" className="text-sm text-danger">{error}</p>:null}
  {result?<div role="status" className="space-y-2 text-sm"><p>Current credential generation {result.generation} · {result.checks?.account?.management_verified?'Management access verified':'Management access unavailable'}</p>
   {result.checks?.minimum_budget?.impressions_daily_minor!=null?<p>Meta impressions daily minimum: {new Intl.NumberFormat('en-MY',{style:'currency',currency:result.checks.minimum_budget.currency}).format(result.checks.minimum_budget.impressions_daily_minor/100)}. Exact lifetime budget acceptance remains unverified.</p>:null}
   <ul className="list-disc pl-4 space-y-1">{result.blockers.map(key=><li key={key}>{reasons[key]||'Meta could not verify this prerequisite. Review account authorization in Ads Manager.'}</li>)}</ul>
  </div>:null}
  <a className="text-xs text-primary" href={`https://adsmanager.facebook.com/adsmanager/manage/advertising_settings${/^\d{1,30}$/.test(accountId||'')?`?act=${accountId}`:''}`} target="_blank" rel="noreferrer">Manage verification in Meta ↗</a>
 </section>;
}
