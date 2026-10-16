import {resolveBrandContext,selectBrandContext} from './brandContext.js';
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext.jsx";
import WorkspacePage from "../../components/layout/WorkspacePage.jsx";
import AdminFilterToolbar from "../../components/layout/AdminFilterToolbar.jsx";
import FeedXDateRangePicker from "../../components/ui/FeedXDateRangePicker.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
import AdminUnderlineTabs from "../../components/navigation/AdminUnderlineTabs.jsx";
import AsyncDataSurface from "../../components/feedback/AsyncDataSurface.jsx";
import EmptyState from "../../components/feedback/EmptyState.jsx";
import Modal from "../../components/feedback/Modal.jsx";
import Badge from "../../components/ui/Badge.jsx";
import { marketingService } from "./marketingService.js";
import { adsService } from "./adsService.js";
import {
  precedingPeriod,
  insightFor,
  adsManagerUrl,
} from "./adsPresentation.js";
import { MetricGrid, Results } from "./AdsMetrics.jsx";
import AdsHistoryCoverage from './AdsHistoryCoverage.jsx';
import {campaignLifetime,observedLifetime} from './adsHistory.js';
import AdsCampaigns from "./AdsCampaigns.jsx";
import ActionMenu from "../../components/ui/ActionMenu.jsx";
import AdsPerformanceTrend from "./AdsPerformanceTrend.jsx";
import AdsManagement from "./AdsManagement.jsx";
import AdsCopilot from "./AdsCopilot.jsx";
import AdsReportingContext from "./AdsReportingContext.jsx";
import AdsAttributionReview from "./AdsAttributionReview.jsx";
import { adsReadiness, adsReportingDay, adsReportingPeriod, adsManagementReason } from "./adsReadiness.js";
import "./ads.css";
const pollError="Reporting status could not refresh. Existing evidence remains visible; reopen Ad Accounts to check connection health.";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const defaultStart = () =>
  new Date(Date.parse(today() + "T00:00:00Z") - 29 * 86400000)
    .toISOString()
    .slice(0, 10);
function ConnectionStatus({ account, report }) {
  const state=adsReadiness(account,report);
  return <div className="ads-reporting-status" role="status"><Badge semantic tone={state.tone}>{state.label === "Ready" ? "Reporting Ready" : state.label}</Badge>{state.label !== "Ready" && <p className="text-sm text-text-secondary">{state.reason}</p>}</div>;
}
export default function MarketingAdsPage() {
  const auth = useAuth(),
    can = (p) => auth.hasPermission(p),
    generation = useRef(0);
  const overviewPeriod = useRef(null);
  const [context, setContext] = useState({ organizations: [], brands: [] }),
    [org, setOrg] = useState(""),
    [brand, setBrand] = useState(""),
    [from, setFrom] = useState(defaultStart),
    [to, setTo] = useState(today),
    [periodMode, setPeriodMode] = useState("30"),
    [data, setData] = useState(null),
    [previous, setPrevious] = useState(null),
    [pending, setPending] = useState([]),
    [discoveries, setDiscoveries] = useState([]),
    [identities, setIdentities] = useState([]),
    [tab, setTab] = useState("overview"),
    [account, setAccount] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [refresh, setRefresh] = useState(0),
    [modal, setModal] = useState(null),
    [manageAccount, setManageAccount] = useState("");
  const brands = context.brands.filter((b) => b.organization_id === org),
    active = data?.accounts.find((a) => a.id === account),
    report = data?.reports.find((r) => r.connection_id === account)?.payload || data?.catalogs?.find(r=>r.connection_id===account)?.payload;
  const reportingDay=adsReportingDay(active?.health?.timezone||"Asia/Kuala_Lumpur");
  useEffect(() => {
    let live = true;
    marketingService
      .context()
      .then((c) => {
        if (!live) return;
        setContext(c);
        const query = new URLSearchParams(location.search), next=resolveBrandContext(c,query.get("marketing_brand"),query.get("marketing_org"));
        setOrg(next.org);setBrand(next.brand);
        if(query.get("meta_result")==="authorization_failed")setNotice(query.get("meta_reason")==="ads_read_not_granted"?"Meta did not grant Ad reporting access. The existing login configuration must provide ads_read (or ads_management); Page permissions do not grant Ad Account reporting.":"Meta authorization could not complete. Check authorized Ad Account access and try Connect Meta again.");
        else if(query.get("meta_result")==="cancelled")setNotice("Meta authorization was cancelled. Existing Ad Accounts are unchanged.");
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const seq = ++generation.current;
    if (!org) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    setData(null);
    setPrevious(null);
    setPending([]);
    setIdentities([]);
    const range = precedingPeriod(from, to);
    if (!range) {
      setLoading(false);
      setError("Select a valid period of up to 37 months.");
      return;
    }
    Promise.all([
      adsService.read(org, brand, from, to),
      periodMode==="lifetime"?Promise.resolve(null):adsService.read(org, brand, range.from, range.to),
      can("marketing_ads.connect")
        ? adsService.pending(org, brand)
        : Promise.resolve([]),
      can("marketing_ads.connect")
        ? adsService.discovery(org).catch(() => [])
        : Promise.resolve([]),
      adsService.reviewContext(org).catch(() => []),
    ])
      .then(([current, before, sessions, reviews, socialIdentities]) => {
        if (seq !== generation.current) return;
        setData(current);
        setPrevious(before);
        setPending(sessions);
        if (sessions.length && new URLSearchParams(location.search).get("meta_result") === "select_account") setTab("accounts");
        setDiscoveries(reviews);
        setIdentities(socialIdentities);
        setAccount((value) =>
          current.accounts.some((a) => a.id === value)
            ? value
            : current.accounts[0]?.id || "",
        );
      })
      .catch((e) => {
        if (seq === generation.current) setError(e.message);
      })
      .finally(() => {
        if (seq === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [org, brand, from, to, refresh, periodMode]);
  async function act(action) {
    const seq = generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await action();
      if (seq === generation.current) {
        setRefresh((r) => r + 1);
        return value;
      }
    } catch (e) {
      if (seq === generation.current) setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function connect(renew = false) {
    if(!renew && data?.accounts.some(a => a.account_id && !adsReadiness(a).reconnect)){setModal({kind:"connect"});return;}
    await act(async () => {
      const result = await adsService.authorize(org, null);
      location.assign(result.authorization_url);
    });
  }
  useEffect(() => {
    if(["custom","lifetime"].includes(periodMode)||!active?.health?.timezone)return;
    const range=adsReportingPeriod(active.health.timezone,Number(periodMode));
    if(range){setFrom(range.from);setTo(range.to);}
  },[account,active?.health?.timezone,periodMode,reportingDay]);
  useEffect(() => {
    if(!org||!precedingPeriod(from,to))return;
    let cancelled=false,inFlight=false;
    const seq=generation.current;
    const timer=setInterval(async()=>{
      if(document.hidden||inFlight)return;
      const rolling=!["custom","lifetime"].includes(periodMode)?adsReportingPeriod(active?.health?.timezone||"Asia/Kuala_Lumpur",Number(periodMode)):null;
      if(rolling&&(rolling.from!==from||rolling.to!==to)){setFrom(rolling.from);setTo(rolling.to);return;}
      inFlight=true;
      try {
        const range=precedingPeriod(from,to);
        const [current,before]=await Promise.all([adsService.read(org,brand,from,to),periodMode==="lifetime"?Promise.resolve(null):adsService.read(org,brand,range.from,range.to)]);
        if(!cancelled&&seq===generation.current){setData(current);setPrevious(before);setNotice(value=>value===pollError?"":value);}
      } catch {if(!cancelled&&seq===generation.current)setNotice(pollError);}
      finally {inFlight=false;}
    },30000);
    return()=>{cancelled=true;clearInterval(timer)};
  },[org,brand,from,to,refresh,periodMode,active?.health?.timezone]);
  function changeTab(next) {
    if(tab==='overview')overviewPeriod.current={from,to,periodMode};
    if(next==='campaigns'&&tab!=='campaigns')setPeriodMode('lifetime');
    if(next==='overview'&&tab!=='overview') {const r=overviewPeriod.current||{...adsReportingPeriod(active?.health?.timezone||'Asia/Kuala_Lumpur',30),periodMode:'30'};setFrom(r.from);setTo(r.to);setPeriodMode(r.periodMode);}
    setTab(next);
  }
  const lifetime=observedLifetime(data,account);
  useEffect(()=>{
    if(tab==='campaigns'&&periodMode==='lifetime'&&lifetime&&(lifetime.from!==from||lifetime.to!==to)){setFrom(lifetime.from);setTo(lifetime.to);}
  },[tab,periodMode,account,lifetime?.from,lifetime?.to,from,to]);
  useEffect(()=>{
    if(!data?.organization_access||periodMode==='lifetime'||!['overview','campaigns'].includes(tab))return;
    const candidate=(tab==='overview'?data.accounts:[active]).find(a=>a?.health?.automatic_history_enabled&&!data.reports.some(r=>r.connection_id===a.id&&r.date_from===from&&r.date_to===to)&&!data.jobs.some(j=>j.connection_id===a.id&&['queued','leased','retry'].includes(j.state)));
    if(!candidate)return;
    let live=true;
    adsService.ensurePeriod(candidate.id,from,to).then(result=>{if(live&&result?.state==='syncing')setRefresh(v=>v+1)}).catch(()=>{if(live)setNotice('Automatic reporting could not be queued. Check Ad Accounts for recovery.');});
    return()=>{live=false};
  },[data,tab,periodMode,account,org,from,to,active?.generation,active?.health?.automatic_history_enabled]);
  function useAccount(a){setAccount(a.id);setModal(null);setTab("overview");setNotice("Using the existing shared Ad Account. Campaign brand attribution is preserved.");}
  const accountRows = (data?.accounts || []).map((a) => {
    const s = data.reports.find((r) => r.connection_id === a.id);
    return { ...a, summary: s?.payload.insights.account?.[0] };
  });
  const beforeReport = previous?.reports?.find(r => r.connection_id === account)?.payload;
  const connectedIds = new Set(accountRows.filter(a => a.account_id).map(a => a.account_id));
  async function syncPeriods(a) {
    await act(async () => {
      await adsService.sync(a.id, from, to);
      setNotice("Reporting queued. This view updates automatically as synchronization completes.");
    });
  }
  const controls = (
    <div className="space-y-3"><div className="admin-scope-controls" aria-label="Marketing scope">
      <SelectField searchable="auto"
        label="Brand"
        value={brand}
        options={[
          { value: "", label: "All" },
          ...context.brands.map((b) => ({ value: b.id, label: b.name })),
        ]}
        onChange={(v) => {
          selectBrandContext(context,v,org,setOrg,setBrand);
        }}
      />
</div><AdminFilterToolbar compact denseFields ariaLabel="Ads date filters"  periodAfterFilters period={<FeedXDateRangePicker from={from} to={to} today={adsReportingPeriod(active?.health?.timezone||"Asia/Kuala_Lumpur")?.to||today()} onApply={({from,to})=>{setNotice("");setPeriodMode("custom");setFrom(from);setTo(to)}}/>}>
      <SelectField
        label="Period"
        value={periodMode}
        onChange={(v) => {
          setNotice("");
          setPeriodMode(v);
          if(v==="custom")return;
          if(v==="lifetime"){setTab("campaigns");return;}
          const range=adsReportingPeriod(active?.health?.timezone||"Asia/Kuala_Lumpur",Number(v));
          if(range){setFrom(range.from);setTo(range.to);}
        }}
        options={[
          { value: "custom", label: "Custom / historical" },
          { value: "30", label: "Last 30 days" },
          { value: "90", label: "Last 90 days" },
          { value: "365", label: "Last 12 months" },
          ...(tab==="campaigns"?[{ value: "lifetime", label: "Lifetime Performance" }]:[]),
        ]}
      />

    </AdminFilterToolbar></div>
  );
  return (
    <WorkspacePage
      section="Marketing"
      title="Ads Analytics"
      description="Advertising performance and decisions across your brands."
      controls={controls}
      actions={
        tab === "accounts" && can("marketing_ads.connect") && data?.organization_access !== false ? (
          <button
            className="btn-primary"
            disabled={busy || !org}
            onClick={() => connect()}
          >
            Connect Ad Account
          </button>
        ) : null
      }
    >
      <AdminUnderlineTabs
        value={tab}
        onChange={changeTab}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "campaigns", label: "Campaigns" },
          { value: "accounts", label: "Ad Accounts" },
          { value: "copilot", label: "AI Copilot" },
          { value: "management", label: "Manage Ads" },
        ]}
      />
      {notice && (
        <p role="status" className="text-sm text-text-secondary">
          {notice}
        </p>
      )}
      {periodMode!=="lifetime" && precedingPeriod(from, to) && (
        <p className="text-xs text-text-secondary">
          Compared with {precedingPeriod(from, to).from}–
          {precedingPeriod(from, to).to}. Reporting dates use the Meta account timezone.
        </p>
      )}
      <AsyncDataSurface
        loading={loading}
        error={error}
        onRetry={() => setRefresh((r) => r + 1)}
        hasData={!!data}
      >
        {!org ? (
          <EmptyState
            title="Marketing access unavailable"
            description="An administrator must grant Brand access and team permissions."
          />
        ) : null}
        {!loading && data && !data.accounts.length ? (
          <EmptyState
            title={data.organization_access===false?"No confirmed brand advertising":"Connect your first Ad Account"}
            description={data.organization_access===false?"An authorized administrator can connect a shared Ad Account and confirm this brand’s campaigns.":"Discover shared Ad Accounts. Campaigns require explicit brand attribution."}
            actions={
              can("marketing_ads.connect") &&
              data?.organization_access !== false ? (
                <button
                  className="btn-secondary"
                  onClick={() => setTab("accounts")}
                  disabled={busy}
                >
                  View Ad Accounts
                </button>
              ) : null
            }
          />
        ) : null}
        {data && ['overview','campaigns','accounts'].includes(tab) && (tab==='overview'?data.accounts:data.accounts.filter(a=>a.id===account)).map(a=><AdsHistoryCoverage key={a.id} data={data} account={a} from={from} to={to}/>)}
        {tab === "overview" &&
          accountRows.map((a) => (
            <section className="ads-panel" key={a.id}>
              <div className="ads-account mb-4">
                <div><h2 className="font-semibold">{a.name}</h2><p className="text-sm text-text-secondary">{brand ? "Confirmed Brand campaigns" : "Shared account totals"} · {a.health?.currency || "Currency unavailable"} · {a.health?.timezone || "Timezone unavailable"}</p></div>
                <ConnectionStatus account={a} report={data.reports.find(r=>r.connection_id===a.id)?.payload}/>
              </div>
              <MetricGrid
                row={a.summary}
                previous={
                  previous?.reports?.find((r) => r.connection_id === a.id)
                    ?.payload.insights.account?.[0]
                }
                currency={a.health?.currency}
              />
              {data.reports.some(r=>r.connection_id===a.id) && !a.summary && !Object.keys(data.reports.find(r=>r.connection_id===a.id)?.payload.warnings||{}).length && <p className="text-sm text-text-secondary">{brand?"No reporting rows are available for this brand. Campaigns must have explicit brand attribution; missing metrics are not zero.":"Meta returned no reporting rows for this period. Missing metrics remain unavailable."}</p>}
              <div className="ads-overview-analysis">
                <AdsPerformanceTrend report={data.reports.find(r => r.connection_id === a.id)?.payload || data.catalogs?.find(r=>r.connection_id===a.id)?.payload}/>
                <Results row={a.summary}/>
              </div>
              <AdsReportingContext
                report={
                  data.reports.find((r) => r.connection_id === a.id)?.payload
                }
                brands={brands}
              />
              {!data.reports.some((r) => r.connection_id === a.id) && (
                <p className="text-sm">
                  No exact-period snapshot yet. Use Sync selected period above; changing dates never starts a provider request.
                </p>
              )}
              <footer className="ads-observation">{data.reports.find(r=>r.connection_id===a.id)?.observed_at ? `Observed ${new Date(data.reports.find(r=>r.connection_id===a.id).observed_at).toLocaleString('en-MY', {timeZone:a.health?.timezone || 'Asia/Kuala_Lumpur'})}` : "No observation for selected period"} · Current reporting refreshes every six hours</footer>
            </section>
          ))}
        {tab === "accounts" && <section className="ads-connections" aria-label="Connected Ad Accounts">
          <h2 className="font-semibold">Connected accounts</h2>
          {accountRows.map(a => <section className="ads-panel" key={a.id}>
            <div className="ads-account">
              <div><h3 className="font-semibold">{a.name}</h3><p className="text-sm text-text-secondary">Shared account · {a.account_id || "Disconnected"} · {a.health?.currency} · {a.health?.timezone}</p></div>
              <div className="flex flex-wrap items-center gap-3"><ConnectionStatus account={a} report={data.reports.find(r=>r.connection_id===a.id)?.payload}/>
              {data?.organization_access && <ActionMenu open={manageAccount===a.id} onOpenChange={open=>setManageAccount(open?a.id:"")} ariaLabel={`Manage ${a.name}`} trigger={({open,toggle})=><button className="btn-secondary" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={toggle}>Manage Connection</button>}>
                {can("marketing_ads.connect") && <button role="menuitem" onClick={()=>{setManageAccount("");connect(true)}}>Reconnect Meta</button>}
                <button role="menuitem" disabled={!a.account_id} onClick={()=>{setManageAccount("");syncPeriods(a)}}>Sync now</button>
                {can("marketing_ads.connect") && <button role="menuitem" disabled={!a.account_id} onClick={()=>{setManageAccount("");setModal({kind:"disconnect",a})}}>Disconnect</button>}
              </ActionMenu>}</div>
            </div>
            <dl className="ads-connection-facts"><div><dt>Reporting access</dt><dd>{a.health?.read_verified?"Verified":"Unverified"}</dd></div><div><dt>Last sync</dt><dd>{a.last_synced_at?new Date(a.last_synced_at).toLocaleString():"No successful sync"}</dd></div><div><dt>Next refresh</dt><dd>{a.health?.next_sync_at?new Date(a.health.next_sync_at).toLocaleString():"Not scheduled"}</dd></div></dl>
            <details className="ads-advanced"><summary>Meta account health & management restrictions</summary><p>{adsManagementReason(a.health)}</p><p>Meta account status: {a.health?.account_status ?? "Unavailable"}. Reporting access is separate from permission to change advertising.</p><p>Last verified: {a.health?.checked_at?new Date(a.health.checked_at).toLocaleString():"Unavailable"}</p><a className="text-primary" href={adsManagerUrl(a.account_id)} target="_blank" rel="noreferrer">Open Ads Manager</a></details>
          </section>)}
          {!pending.length && data?.organization_access && <div className="ads-panel"><h2 className="font-semibold">Available accounts</h2><p className="text-sm text-text-secondary">Connect Meta to discover additional authorized accounts. Existing connections are reused.</p></div>}
        </section>}
        {tab === "accounts" && data?.organization_access &&
          discoveries.filter(d => !connectedIds.has(d.account_id)).map((d) => (
            <section className="ads-panel" key={d.account_id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <strong>{d.payload.account.name}</strong>
                  <p className="text-sm text-text-secondary">
                    Shared account discovery ·{" "}
                    {d.payload.configs.campaigns.length} campaigns · No
                    connection binding
                  </p>
                </div>
                <button
                  className="btn-secondary"
                  onClick={() =>
                    setModal({ kind: "preview", report: d.payload })
                  }
                >
                  Review history
                </button>
              </div>
            </section>
          ))}
        {tab === "accounts" && pending.map((session) => (
          <section key={session.id} className="ads-panel">
            <h2 className="font-semibold">Available accounts</h2>
            <p className="text-sm text-text-secondary">
              Shared Ad Accounts can serve multiple authorized Brands. Read-only discovery
              creates no brand attribution or execution authority.
            </p>
            {!session.accounts.filter(a => !connectedIds.has(a.id)).length ? (
              <p className="text-sm text-text-secondary">No additional accounts available. Connected accounts are listed above.</p>
            ) : (
              session.accounts.filter(a => !connectedIds.has(a.id)).map((a) => (
                <div key={a.id} className="ads-account">
                  <div>
                    <strong>{a.name}</strong>
                    <p className="text-sm text-text-secondary">
                      {a.currency} · {a.timezone} · {a.id}
                    </p>
                  </div>
                  <button
                    className="btn-secondary"
                    disabled={!a.available || busy}
                    onClick={() =>
                      act(async () => {
                        const result = await adsService.preview(
                          session.id,
                          a.id,
                          from,
                          to,
                        );
                        setModal({ kind: "preview", report: result.report });
                      })
                    }
                  >
                    Read-only discovery
                  </button>
                  {data?.organization_access && (
                    <button
                      className="btn-secondary"
                      disabled={!a.available || busy}
                      onClick={() => setModal({ kind: "bind", session, a })}
                    >
                      Connect shared account
                    </button>
                  )}
                </div>
              ))
            )}
          </section>
        ))}
        {tab === "campaigns" && periodMode==='lifetime' && <p className="text-sm text-text-secondary" role="status">{lifetime?`Lifetime Performance · exact Meta-observed period ${lifetime.from}–${lifetime.to}. Widest saved observation; earlier lifetime activity is not established.`:'Lifetime Performance is awaiting its first complete historical observation. Available configuration is shown without invented metrics.'}</p>}
        {tab === "campaigns" && data?.accounts.length > 0 && <AdsCampaigns key={`${org}:${brand}`} accounts={data.accounts} account={account} onAccount={setAccount} report={periodMode==='lifetime'&&!lifetime?data?.catalogs?.find(r=>r.connection_id===account)?.payload:report} brands={brands} canReview={data.organization_access && !brand} onReview={()=>setModal({kind:"preview",report})} onDetail={(row,level,onDrill)=>setModal({kind:"detail",row,level,onDrill})}/>}
        {tab === "management" && (
          <AdsManagement
            key={`${org}:${brand}:${account}`}
            org={org}
            brand={brand}
            brands={brands}
            accounts={data?.accounts || []}
            report={report}
            can={can}
          />
        )}
        {tab === "copilot" && (
          <AdsCopilot
            org={org}
            brand={brand}
            account={account}
            evidenceVersion={[data?.reports.find(r=>r.connection_id===account)?.observed_at||'',...(report?.configs?.campaigns||[]).map(c=>`${c.id}:${c.feedx_attribution_revision}`)].join('|')}
            from={from}
            to={to}
            canGenerate={can("marketing_ads.ai")}
            canReview={can("marketing_ads.review")}
          />
        )}
        {data?.jobs?.some((j) => ["failed", "cancelled"].includes(j.state)) && (
          <p className="text-sm text-text-secondary">
            A synchronization could not finish. Check account access or choose a
            smaller reporting period, then retry.
          </p>
        )}
        {data?.jobs?.filter((j) =>
          ["queued", "leased", "retry"].includes(j.state),
        ).length > 0 && (
          <p role="status" className="text-sm text-text-secondary">
            Advertising synchronization is pending.{" "}
            <button
              className="text-primary"
              onClick={() => setRefresh((r) => r + 1)}
            >
              Refresh
            </button>
          </p>
        )}
      </AsyncDataSurface>
      {modal?.kind === "connect" && <Modal title="Choose an Ad Account connection" onClose={()=>setModal(null)} footer={<button className="btn-primary" disabled={busy} onClick={()=>{setModal(null);connect(true)}}>Connect Meta</button>}><p className="text-sm text-text-secondary">Reuse an authorized shared account for another brand, or connect Meta to discover additional eligible accounts. Campaign brands are confirmed separately to preserve shared-account spend.</p>{accountRows.filter(a=>a.account_id&&!adsReadiness(a).reconnect).map(a=><div className="ads-account mt-3" key={a.id}><strong>{a.name}</strong><button className="btn-secondary" onClick={()=>useAccount(a)}>Use connected account</button></div>)}</Modal>}
      {modal?.kind === "preview" && (
        <Modal
          size="3xl"
          title="Shared Ad Account review"
          onClose={() => setModal(null)}
        >
          <p className="text-sm text-text-secondary">
            {modal.report.account.name} · {modal.report.account.currency} ·{" "}
            {modal.report.account.timezone}. Selected reporting period{" "}
            {modal.report.date_from||from}–{modal.report.date_to||to}. Meta configuration
            remains authoritative.
          </p>
          <MetricGrid
            row={modal.report.insights.account?.[0]}
            currency={modal.report.account.currency}
          />
          <p className="text-sm text-text-secondary mb-3">
            {modal.report.configs.campaigns.length} campaigns ·{" "}
            {modal.report.configs.adsets.length} Ad Sets ·{" "}
            {modal.report.configs.ads.length} Ads. Brand attribution requires
            explicit administrator review.
          </p>
          <AdsAttributionReview
            report={modal.report}
            from={from}
            to={to}
            org={org}
            brands={brands}
            identities={identities}
            canManage={can("marketing_ads.manage") && data?.organization_access}
            onUpdated={() => {
              setModal(null);
              setRefresh((r) => r + 1);
              setNotice(
                "FeedX attribution updated. Meta advertising is unchanged.",
              );
            }}
          />
          <details className="mt-4">
            <summary>Meta reporting evidence</summary>
            <pre className="overflow-auto text-xs max-h-60">
              {JSON.stringify(modal.report.warnings, null, 2)}
              {modal.report.observation}
            </pre>
          </details>
        </Modal>
      )}
      {modal?.kind === "bind" && (
        <Modal
          title="Confirm Ad Account ownership"
          onClose={() => setModal(null)}
          footer={
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await adsService.bind(
                    modal.session.id,
                    brand,
                    modal.a.id,
                    data?.accounts.find(
                      (a) => (a.account_id || a.account_slot) === modal.a.id,
                    )?.generation ?? null,
                  );
                  setModal(null);
                  setNotice(
                    "Ad Account confirmed. Initial 30-day reporting and the comparison period are queued automatically. Confirm campaign brands after reporting loads.",
                  );
                })
              }
            >
              Confirm connection
            </button>
          }
        >
          <p>Connect <strong>{modal.a.name}</strong> ({modal.a.id}) as a shared Ad Account? Campaign Brand attribution remains separate.</p>
          <p className="mt-3 text-sm text-text-secondary">
            Reporting permissions are verified before binding. The first 30 days and comparison period sync automatically. This shared account is shared across permitted Brands; confirm individual campaign brands after reporting loads. Existing attribution is preserved when reconnecting.
          </p>
        </Modal>
      )}
      {modal?.kind === "disconnect" && (
        <Modal
          title="Disconnect Ad Account"
          onClose={() => setModal(null)}
          footer={
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await adsService.disconnect(modal.a.id);
                  setModal(null);
                })
              }
            >
              Disconnect
            </button>
          }
        >
          <p>
            Remove FeedX access to {modal.a.name}? This does not pause or delete
            advertising in Meta.
          </p>
        </Modal>
      )}
      {modal?.kind === "detail" && (
        <Modal
          title={modal.row.name}
          placement="right"
          onClose={() => setModal(null)}
        >
          <div className="space-y-5">
            {modal.level==='campaign' && campaignLifetime(modal.row,reportingDay,active?.health?.timezone) && <button className="btn-secondary" onClick={()=>{const r=campaignLifetime(modal.row,reportingDay,active?.health?.timezone);setPeriodMode('lifetime');setFrom(r.from);setTo(r.to);setModal(null);setNotice(`Campaign lifetime: ${modal.row.name} · ${r.from}–${r.to}${r.limited?' · limited to the requestable history window':''}. All metrics use this exact period; older observations are not fabricated.`);}}>Campaign lifetime</button>}
          {modal.level==='campaign'&&!campaignLifetime(modal.row,reportingDay,active?.health?.timezone)&&<p className="text-sm text-text-secondary">Lifetime reporting is unavailable: this campaign has no usable configured dates within the requestable history window.</p>}
          {modal.onDrill && <button className="btn-secondary" onClick={()=>{modal.onDrill();setModal(null)}}>View {modal.level === "campaign" ? "Ad Sets" : "Ads"}</button>}
            <Badge>{modal.row.effective_status || "Status unavailable"}</Badge>
            <MetricGrid
              row={insightFor(report, modal.level, modal.row.id)}
              previous={insightFor(beforeReport, modal.level, modal.row.id)}
              currency={active?.health?.currency}
            />
            <Results row={insightFor(report, modal.level, modal.row.id)} />
            <dl className="space-y-2 text-sm">
              {[
                "objective",
                "optimization_goal",
                "billing_event",
                "start_time",
                "end_time",
                "stop_time",
                "daily_budget",
                "lifetime_budget",
              ]
                .filter((k) => modal.row[k] != null)
                .map((k) => (
                  <div key={k}>
                    <dt className="text-text-secondary">
                      {k.replaceAll("_", " ")}
                    </dt>
                    <dd>
                      {String(modal.row[k])}
                      {k.includes("budget") ? " Meta minor currency units" : ""}
                    </dd>
                  </div>
                ))}
            </dl>
            {["targeting", "attribution_spec", "creative"]
              .filter((k) => modal.row[k])
              .map((k) => (
                <details key={k}>
                  <summary>{k.replaceAll("_", " ")}</summary>
                  <pre className="whitespace-pre-wrap break-words text-xs">
                    {JSON.stringify(modal.row[k], null, 2)}
                  </pre>
                </details>
              ))}
            <a
              className="btn-secondary"
              href={adsManagerUrl(
                active?.account_id,
                modal.row.id,
                modal.level,
              )}
              target="_blank"
              rel="noreferrer"
            >
              Advanced settings in Ads Manager ↗
            </a>
            <p className="text-xs text-text-secondary">
              Meta owns configuration and delivery. Advertising changes require
              separate approval and execution authorization.
            </p>
          </div>
        </Modal>
      )}
    </WorkspacePage>
  );
}
