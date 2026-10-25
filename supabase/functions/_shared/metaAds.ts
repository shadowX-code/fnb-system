import { MetaGraph, MetaError } from "./metaGraph.ts";
import { connectionBinding, unseal } from "./metaSecurity.ts";
const id = (v: unknown) => typeof v === "string" && /^\d{1,30}$/.test(v);
export const ADS_ACCOUNT_FIELDS =
  "id,account_id,name,currency,timezone_name,account_status,disable_reason,user_tasks";
export const ADS_CONFIG_FIELDS = {
  campaigns:
    "id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time,updated_time,special_ad_categories",
  adsets:
    "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,start_time,end_time,targeting,optimization_goal,billing_event,attribution_spec,updated_time",
  ads: "id,name,campaign_id,adset_id,status,effective_status,creative{id,name,object_story_id,object_story_spec,thumbnail_url},updated_time",
};

const tasks = new Set([
  "MANAGE",
  "ADVERTISE",
  "ANALYZE",
  "AA_ANALYZE",
  "DRAFT",
]);
export function adsAccount(row: any, scopes: string[]) {
  const accountId = String(row?.account_id || "");
  if (
    !id(accountId) ||
    row.id !== `act_${accountId}` ||
    !/^([A-Z]{3})$/.test(row.currency || "") ||
    typeof row.timezone_name !== "string" ||
    !row.timezone_name
  )
    throw new MetaError("ad_account_identity_mismatch");
  const granted = (Array.isArray(row.user_tasks) ? row.user_tasks : []).filter(
    (v: string) => tasks.has(v),
  );
  return {
    id: accountId,
    name: String(row.name || "Meta Ad Account").slice(0, 200),
    channel: "ad_account",
    currency: row.currency,
    timezone: row.timezone_name,
    account_status: Number.isSafeInteger(row.account_status)
      ? row.account_status
      : null,
    disable_reason: Number.isSafeInteger(row.disable_reason)
      ? row.disable_reason
      : null,
    tasks: granted,
    granted_scopes: [
      ...new Set(
        scopes.filter(
          (scope) => typeof scope === "string" && /^[a-z_]{1,80}$/.test(scope),
        ),
      ),
    ].sort(),
    read_verified:
      scopes.includes("ads_read") || scopes.includes("ads_management"),
    manage_verified:
      scopes.includes("ads_management") &&
      granted.some((t: string) => ["MANAGE", "ADVERTISE"].includes(t)) &&
      row.account_status === 1,
    manage_reason: !scopes.includes("ads_management")
      ? "ads_management_required"
      : !granted.some((t: string) => ["MANAGE", "ADVERTISE"].includes(t))
        ? "ad_tasks_unverified"
        : row.account_status !== 1
          ? "account_not_active"
          : "verified",
    execution_enabled: false,
  };
}
export async function adsPages(
  graph: MetaGraph,
  path: string,
  token: string,
  params: Record<string, any>,
  guard: () => Promise<void> = async () => {},
) {
  const rows: any[] = [];
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    await guard();
    const body = await graph.request(path, token, {
      ...params,
      limit: 50,
      after,
    });
    if (!Array.isArray(body.data))
      throw new MetaError("ads_response_unreadable");
    rows.push(...body.data);
    if (!body.paging?.next) return rows;
    after = body.paging?.cursors?.after;
    if (typeof after !== "string" || !after || after.length > 2048)
      throw new MetaError("ads_pagination_unavailable");
  }
  throw new MetaError("ads_pagination_limit");
}
export async function verifyAdsUser(
  graph: MetaGraph,
  appId: string,
  appSecret: string,
  token: string,
  expectedUser?: string,
) {
  const d = (
    await graph.request("debug_token", `${appId}|${appSecret}`, {
      input_token: token,
    })
  ).data;
  if (
    !d?.is_valid ||
    String(d.app_id) !== appId ||
    d.type !== "USER" ||
    !id(String(d.user_id))
  )
    throw new MetaError("meta_permission_or_token_invalid");
  if (expectedUser && String(d.user_id) !== expectedUser)
    throw new MetaError("ad_authorizer_changed");
  if (
    [d.expires_at, d.data_access_expires_at].some(
      (v) => Number(v) > 0 && Number(v) <= Date.now() / 1000,
    )
  )
    throw new MetaError("meta_permission_or_token_invalid");
  const scopes = Array.isArray(d.scopes) ? d.scopes : [];
  if (!scopes.includes("ads_read") && !scopes.includes("ads_management"))
    throw new MetaError("ads_read_not_granted");
  return { userId: String(d.user_id), scopes };
}
export async function discoverAds(graph: MetaGraph, code: string) {
  const { token, debug, expiresAt } = await graph.exchangeUser(code);
  if (debug.type !== "USER") throw new MetaError("user_token_required");
  const scopes = Array.isArray(debug.scopes) ? debug.scopes : [];
  if (!scopes.includes("ads_read") && !scopes.includes("ads_management"))
    throw new MetaError("ads_read_not_granted");
  const accounts = (
    await adsPages(graph, "me/adaccounts", token, {
      fields: ADS_ACCOUNT_FIELDS,
    })
  ).map((a) => adsAccount(a, scopes));
  return { token, userId: String(debug.user_id), expiresAt, accounts };
}
export async function verifyAdsAccount(
  graph: MetaGraph,
  appId: string,
  appSecret: string,
  token: string,
  accountId: string,
  expectedUser?: string,
  guard: () => Promise<void> = async () => {},
) {
  if (!id(accountId)) throw new MetaError("ad_account_identity_mismatch");
  await guard();
  const user = await verifyAdsUser(
    graph,
    appId,
    appSecret,
    token,
    expectedUser,
  );
  // me/adaccounts proves this exact authorizer's account visibility, independently of Page bindings.
  const authorized = await adsPages(
    graph,
    "me/adaccounts",
    token,
    { fields: ADS_ACCOUNT_FIELDS },
    guard,
  );
  const selected = authorized.find(
    (a) => a.id === `act_${accountId}` && String(a.account_id) === accountId,
  );
  if (!selected) throw new MetaError("ad_account_access_unverified");
  await guard();
  const account = adsAccount(
    await graph.request(`act_${accountId}`, token, {
      fields: ADS_ACCOUNT_FIELDS,
    }),
    user.scopes,
  );
  if (account.id !== accountId)
    throw new MetaError("ad_account_identity_mismatch");
  return account;
}
const insightFields = [
  "spend",
  "reach",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "actions",
  "cost_per_action_type",
  "action_values",
];
const numeric = (v: any) =>
  v !== null &&
  v !== undefined &&
  v !== "" &&
  Number.isFinite(Number(v)) &&
  Number(v) >= 0
    ? Number(v)
    : null;
export function adsInsight(row: any) {
  const metrics: Record<string, any> = {};
  for (const field of insightFields.filter(
    (x) => !["actions", "cost_per_action_type", "action_values"].includes(x),
  ))
    metrics[field] = {
      value: numeric(row[field]),
      state:
        numeric(row[field]) === null
          ? "unavailable"
          : field === "reach"
            ? "estimated"
            : "reported",
    };
  const action = (rows: any) =>
    Array.isArray(rows)
      ? rows
          .filter(
            (a) =>
              typeof a?.action_type === "string" && numeric(a.value) !== null,
          )
          .map((a) => ({ type: a.action_type, value: numeric(a.value) }))
      : null;
  return {
    account_id: row.account_id,
    campaign_id: row.campaign_id,
    adset_id: row.adset_id,
    ad_id: row.ad_id,
    date_start: row.date_start,
    date_stop: row.date_stop,
    currency: row.account_currency,
    metrics,
    actions: action(row.actions),
    cost_per_action_type: action(row.cost_per_action_type),
    action_values: action(row.action_values),
    attribution:
      "Meta ad-set attribution settings; conversion-time reporting. Modeled/estimated conversions may be included; not verified FeedX sales.",
  };
}
export async function readAdsReport(
  graph: MetaGraph,
  account: any,
  token: string,
  from: string,
  to: string,
  guard: () => Promise<void>,
) {
  const base = `act_${account.id}`,
    warnings: Record<string, string> = {};
  const configs: Record<string, any[]> = {};
  for (const [edge, fields] of Object.entries(ADS_CONFIG_FIELDS)) {
    // A core configuration failure fails the job: never present a partial account as reconciled.
    configs[edge] = await adsPages(
      graph,
      `${base}/${edge}`,
      token,
      { fields },
      guard,
    );
  }
  const insights: Record<string, any[]> = {};
  for (const level of ["account", "campaign", "adset", "ad", "daily"]) {
    try {
      insights[level] = (
        await adsPages(
          graph,
          `${base}/insights`,
          token,
          {
            fields: [
              "account_id",
              "account_currency",
              "campaign_id",
              "adset_id",
              "ad_id",
              "date_start",
              "date_stop",
              ...insightFields,
            ].join(","),
            level: level === "daily" ? "account" : level,
            time_range: { since: from, until: to },
            use_unified_attribution_setting: true,
            action_report_time: "conversion",
            ...(level === "daily" ? { time_increment: 1 } : {}),
          },
          guard,
        )
      ).map(adsInsight);
    } catch (error) {
      if (error instanceof MetaError && error.code === "ads_pagination_limit")
        warnings[level] =
          "More data than supported in one synchronization; narrow the date range.";
      else
        warnings[level] =
          error instanceof MetaError ? error.code : "insights_unavailable";
      insights[level] = [];
    }
  }
  await guard();
  return {
    account,
    configs,
    insights,
    warnings,
    date_from: from,
    date_to: to,
    source: "Meta Marketing API",
    observation:
      "Reporting may be delayed or revised by Meta. Reach is estimated and non-additive. Budget fields use Meta minor currency units.",
  };
}
// Long ranges use the same report shape and exact-period Meta aggregates. Each
// tick reads at most three pages; only daily rows split into non-overlapping windows.
export async function readAdsHistoryStep(graph: MetaGraph, account: any, token: string,
 from: string, to: string, saved: any, guard: () => Promise<void>) {
 const state = structuredClone(saved?.report ? saved : {step:0,page:0,after:null,window:from,requests:0,
  report:{account,configs:{},insights:{},warnings:{},date_from:from,date_to:to,source:'Meta Marketing API',
   history:{method:'exact_period_aggregates',daily_window_days:90,graph_version:graph.version,started_at:new Date().toISOString()},
   observation:'Exact-period provider aggregates; daily rows are not summed into Reach. Meta may restrict older metrics.'}});
 state.report.account=account;
 const initialRequests=state.requests;
 const canContinue=async()=>{try{await guard();return true;}catch(e){if(e instanceof MetaError&&e.code==='ads_sync_time_limit'&&state.requests>initialRequests)return false;throw e;}};
 const stages=['campaigns','adsets','ads','account','campaign','adset','ad','daily'];
 const advance=()=>{state.step++;state.page=0;state.after=null;state.seen=[];state.window=from;state.omitReach=false;};
 for(let calls=0;calls<3 && state.step<stages.length;calls++) {
  const stage=stages[state.step],config=state.step<3,daily=stage==='daily';
  if(state.requests>=220)throw new MetaError('ads_history_request_limit');
  const end=daily?new Date(Math.min(Date.parse(to+'T00:00:00Z'),Date.parse(state.window+'T00:00:00Z')+89*86400000)).toISOString().slice(0,10):to;
  const target=config?state.report.configs:state.report.insights;
  target[stage]??=[];
  if(!await canContinue())return {state,complete:false};
  try {
   const response=await graph.request(`act_${account.id}/${config?stage:'insights'}`,token,{
    fields:config?ADS_CONFIG_FIELDS[stage as keyof typeof ADS_CONFIG_FIELDS]:['account_id','account_currency','campaign_id','adset_id','ad_id','date_start','date_stop',...insightFields.filter(f=>!state.omitReach||f!=='reach')].join(','),
    ...(config?{}:{level:daily?'account':stage,time_range:{since:daily?state.window:from,until:end},use_unified_attribution_setting:true,action_report_time:'conversion',...(daily?{time_increment:1}:{})}),
    limit:50,after:state.after||undefined});
   if(!Array.isArray(response.data))throw new MetaError('ads_response_unreadable');
   if(state.omitReach){state.report.metric_warnings??={};state.report.metric_warnings[stage]={reach:'Provider rejected this range with Reach; core metrics succeeded without Reach.'};}
   const rows=config?response.data:response.data.map((r:any)=>{const v=adsInsight(r);if(state.omitReach)v.metrics.reach={value:null,state:'unavailable',reason:'provider_rejected_range_with_reach'};if(v.attribution===state.report.insight_attribution)delete (v as any).attribution;return v;});
   const key=(row:any)=>config?row.id:[row.account_id,row.campaign_id,row.adset_id,row.ad_id,row.date_start,row.date_stop].join(':');
   const seen=new Map(target[stage].map((r:any)=>[key(r),r]));
   const ordered=(_key:string,v:any)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v;
   for(const row of rows){const old=seen.get(key(row));if(old&&JSON.stringify(old,ordered)!==JSON.stringify(row,ordered))throw new MetaError('ads_page_overlap_changed');seen.set(key(row),row);}
   target[stage]=[...seen.values()];
   state.requests++;state.page++;
   if(response.paging?.next){
    const next=response.paging?.cursors?.after;
    if(typeof next!=='string'||!next||next.length>2048||(state.seen||[]).includes(next))throw new MetaError('ads_pagination_unavailable');
    if(state.page>=10)throw new MetaError('ads_pagination_limit');
    state.seen=[...(state.seen||[]),next];state.after=next;
   } else if(daily&&end<to){state.window=new Date(Date.parse(end+'T00:00:00Z')+86400000).toISOString().slice(0,10);state.after=null;state.page=0;state.seen=[];}
   else advance();
  } catch(error) {
   // Authority changes and temporary failures retry the same persisted cursor.
   if(config || !(error instanceof MetaError) || error.retryable || ['ads_sync_time_limit','meta_permission_or_token_invalid','ads_authority_changed'].includes(error.code))throw error;
   if(error.graphCode===100 && !state.omitReach){
    state.omitReach=true;state.page=0;state.after=null;state.seen=[];target[stage]=daily?target[stage].filter((r:any)=>r.date_start<state.window):[];state.requests++;
    continue;
   }
   if(state.report.metric_warnings)delete state.report.metric_warnings[stage];
   state.report.warnings[stage]=error.code;
   state.requests++;
   if(daily){
    // A restricted old window does not hide later eligible daily observations.
    target[stage]=target[stage].filter((r:any)=>r.date_start<state.window);
    state.report.daily_gaps??=[];state.report.daily_gaps.push({from:state.window,to:end,reason:error.code});
    if(end<to){state.window=new Date(Date.parse(end+'T00:00:00Z')+86400000).toISOString().slice(0,10);state.after=null;state.page=0;state.seen=[];}else advance();
   }else{target[stage]=[];advance();}
  }
 }
 const withinTurn=await canContinue();
 // The database packs repeated attribution and enforces the 3 MB UTF-8 storage
 // budget. Bound the incoming expanded envelope too, before sending it there.
 if(new TextEncoder().encode(JSON.stringify(state)).length>6000000)throw new MetaError('ads_history_evidence_limit');
 return {state,complete:withinTurn&&state.step===stages.length};
}

export async function processAdsSync(
  db: any,
  graph: MetaGraph,
  env: (key: string) => string,
) {
  const call = async (name: string, args: any = {}) => {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new MetaError(error.code === '54000' ? 'ads_history_evidence_limit' : name === 'marketing_ads_finish' ? 'ads_report_finalization_failed' : "ads_authority_changed");
    return data;
  };
  const job = await call("marketing_ads_claim");
  if (!job) return false;
  const deadline = Date.now() + 85000;
  const guard = async () => {
    if (Date.now() > deadline) throw new MetaError("ads_sync_time_limit");
    await call("marketing_ads_material", { p_job: job.id, p_lease: job.lease });
  };
  let report: any = null,
    error: string | null = null;
  try {
    const material = await call("marketing_ads_material", {
      p_job: job.id,
      p_lease: job.lease,
    });
    // A completed checkpoint already contains all provider evidence. Revalidate
    // current database authority, then finalize without another provider read.
    if (job.progress?.step === 8 && job.progress?.report) {
      await call("marketing_ads_finish", {
        p_job: job.id, p_lease: job.lease,
        p_report: job.progress.report, p_error: null,
      });
      return true;
    }
    const credential = await unseal(
      material.sealed_token,
      [
        env("MARKETING_META_TOKEN_ENCRYPTION_KEY"),
        env("MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY"),
      ],
      connectionBinding(material),
    );
    const account = await verifyAdsAccount(
      graph,
      env("MARKETING_META_APP_ID"),
      env("MARKETING_META_APP_SECRET"),
      credential.token,
      material.provider_account_id,
      material.meta_user_id,
      guard,
    );
    if (Date.parse(job.date_to)-Date.parse(job.date_from)>93*86400000) {
      const next=await readAdsHistoryStep(graph,account,credential.token,job.date_from,job.date_to,job.progress,guard);
      if(next.state.step===8)next.state.report.history={...next.state.report.history,completed_at:new Date().toISOString()};
      // Persist the final page as well. A later lease owns finalization, so an
      // RPC timeout or worker interruption cannot lose the last provider page.
      await call('marketing_ads_checkpoint',{p_job:job.id,p_lease:job.lease,p_progress:next.state});
      return true;
    } else report = await readAdsReport(graph,account,credential.token,job.date_from,job.date_to,guard);
  } catch (e) {
    error = e instanceof MetaError ? e.code : "ads_authority_changed";
  }
  await call("marketing_ads_finish", {
    p_job: job.id,
    p_lease: job.lease,
    p_report: report,
    p_error: error,
  });
  return true;
}
