const authorizationErrors=new Set(['meta_permission_or_token_invalid','ads_read_not_granted','ad_account_identity_mismatch','ad_authorizer_changed','ad_account_access_unverified']);
export function adsReportingDay(timezone,now=new Date()) {
  try {return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now)} catch {return null}
}
export function adsReportingPeriod(timezone,days=30,now=new Date()) {
  const to=adsReportingDay(timezone,now);if(to&&days===365){const end=new Date(to+'T00:00:00Z'),year=end.getUTCFullYear()-1,month=end.getUTCMonth(),last=new Date(Date.UTC(year,month+1,0)).getUTCDate();const start=new Date(Date.UTC(year,month,Math.min(end.getUTCDate(),last)));start.setUTCDate(start.getUTCDate()+1);return {from:start.toISOString().slice(0,10),to};}return to?{from:new Date(Date.parse(to+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10),to}:null;
}
export function adsManagementReason(health) {
  if(health?.manage_verified)return 'Verified; separate execution approval required';
  if(health?.account_status!=null&&health.account_status!==1)return 'Meta account is not active. Check account health in Ads Manager; reporting can remain available.';
  if(health?.granted_scopes?.length&&!health.granted_scopes.includes('ads_management'))return 'Meta ads_management permission is unavailable. Reporting permission does not authorize advertising changes.';
  return 'Account management eligibility must be verified before execution.';
}
export function adsCopilotHasPerformance(packet,connection) {
  const payload=packet?.reporting?.reports?.find(r=>r.connection_id===connection)?.payload;
  if(!payload)return false;
  const campaigns=new Set((payload.configs?.campaigns||[]).map(c=>c.id));
  return (payload.insights?.campaign||[]).some(r=>campaigns.has(r.campaign_id)&&r.currency===payload.account?.currency&&r.date_start===payload.date_from&&r.date_stop===payload.date_to&&Number.isFinite(r.metrics?.spend?.value)&&r.metrics.spend.value>=0);
}
export function adsReadiness(account,report,now=Date.now()) {
  const health=account?.health,sync=account?.sync;
  const error=health?.automatic_error||health?.sync_error||account?.error_code||(sync?.latest_job?.state==='failed'?sync.latest_job.error_code:null);
  if(account?.status==='not_connected')return {label:'Needs Attention',tone:'neutral',reason:'This account is disconnected. Connect Meta to restore reporting.',reconnect:true};
  if(account?.status==='expired'||(account?.expires_at&&Date.parse(account.expires_at)<=now)||authorizationErrors.has(error))return {label:'Needs Attention',tone:'danger',reason:'Meta reporting authorization is unavailable or expired. Reconnect this Ad Account.',reconnect:true};
  if(sync?.worker_available===false)return {label:'Needs Attention',tone:'warning',reason:'Automatic reporting is temporarily unavailable. A Marketing administrator must resolve the shared service issue.'};
  if(sync?.active_jobs>0)return {label:'Syncing',tone:'info',reason:`Reporting is queued or processing${sync.initial_total?` · ${sync.initial_completed}/${sync.initial_total} initial periods complete`:''}. FeedX updates this view automatically.`};
  if(error)return {label:'Needs Attention',tone:'warning',reason:error==='ads_reporting_actor_unavailable'?'The connection owner needs shared-account Ads reporting access. An authorized administrator can reconnect the account.':error==='ads_timezone_unavailable'?'Meta account reporting timezone could not be verified. Resolve account configuration before syncing.':error==='ads_pagination_limit'||error==='ads_sync_time_limit'?'This account exceeds a synchronization limit. Try a smaller period; large configuration lists require additional provider support.':'Reporting could not finish. Temporary failures retry automatically; use Sync now in Ad Accounts for recovery.'};
  if(report&&Object.keys(report.warnings||{}).length)return {label:'Needs Attention',tone:'warning',reason:'Configuration synchronized, but some Meta reporting is unavailable. Available metrics remain visible; check the reporting details.'};
  if(report)return {label:'Ready',tone:'success',reason:'Meta reporting is synchronized for the selected period.'};
  return {label:'Connected',tone:'neutral',reason:account?.last_synced_at?'This period has not been synchronized. Current reporting refreshes automatically; eligible missing historical periods synchronize automatically after platform activation.':'Authorization is retained. Initial reporting is queued automatically after confirmation.'};
}
