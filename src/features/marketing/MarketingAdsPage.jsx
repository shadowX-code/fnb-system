import {resolveBrandContext,selectBrandContext} from './brandContext.js';
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext.jsx";
import WorkspacePage from "../../components/layout/WorkspacePage.jsx";
import AdminFilterToolbar from "../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../components/forms/AdminSearchField.jsx";
import FeedXDateRangePicker from "../../components/ui/FeedXDateRangePicker.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
import AdminUnderlineTabs from "../../components/navigation/AdminUnderlineTabs.jsx";
import DataTable from "../../components/tables/DataTable.jsx";
import AsyncDataSurface from "../../components/feedback/AsyncDataSurface.jsx";
import EmptyState from "../../components/feedback/EmptyState.jsx";
import Modal from "../../components/feedback/Modal.jsx";
import Badge from "../../components/ui/Badge.jsx";
import { marketingService } from "./marketingService.js";
import { adsService } from "./adsService.js";
import {
  adsMetricNames,
  adsMetric,
  precedingPeriod,
  metricComparison,
  insightFor,
  adsManagerUrl,
} from "./adsPresentation.js";
import AdsPerformanceTrend from "./AdsPerformanceTrend.jsx";
import AdsManagement from "./AdsManagement.jsx";
import AdsCopilot from "./AdsCopilot.jsx";
import AdsReportingContext from "./AdsReportingContext.jsx";
import AdsAttributionReview from "./AdsAttributionReview.jsx";
import { adsReadiness, adsReportingDay, adsReportingPeriod, adsManagementReason } from "./adsReadiness.js";
import "./ads.css";
const pollError="Reporting status could not refresh. Existing evidence remains visible; use Refresh data to retry.";
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
  return <div className="space-y-2" role="status"><Badge semantic tone={state.tone}>{state.label}</Badge><p className="text-sm text-text-secondary">{state.reason}</p></div>;
}
function MetricGrid({ row, previous, currency }) {
  return (
    <dl className="ads-metrics">
      {Object.entries(adsMetricNames).map(([key, label]) => (
        <div key={key}>
          <dt>
            {label}
            {row?.metrics?.[key]?.state === "estimated"
              ? " · estimated"
              : row?.metrics?.[key]?.state === "derived"
                ? " · calculated"
                : ""}
          </dt>
          <dd>{adsMetric(row?.metrics?.[key], key, currency)}</dd>
          {metricComparison(row?.metrics?.[key], previous?.metrics?.[key]) && (
            <small>
              {metricComparison(row.metrics[key], previous.metrics[key])} vs
              previous period
            </small>
          )}
        </div>
      ))}
    </dl>
  );
}
function Results({ row }) {
  return !row?.actions?.length ? (
    <p className="text-sm text-text-secondary">
      Results unavailable for this period.
    </p>
  ) : (
    <div className="space-y-2">
      {row.actions.map((action) => (
        <div
          key={action.type}
          className="flex flex-wrap justify-between gap-2 text-sm"
        >
          <span>{action.type.replaceAll("_", " ")}</span>
          <span>
            {action.value} ·{" "}
            {row.cost_per_action_type?.find((a) => a.type === action.type)
              ?.value != null
              ? `${row.currency} ${row.cost_per_action_type.find((a) => a.type === action.type).value} per result`
              : "Cost per result unavailable"}
          </span>
        </div>
      ))}
      <p className="text-xs text-text-secondary">{row.attribution}</p>
    </div>
  );
}
export default function MarketingAdsPage() {
  const auth = useAuth(),
    can = (p) => auth.hasPermission(p),
    generation = useRef(0);
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
    [level, setLevel] = useState("campaign"),
    [parent, setParent] = useState(""),
    [resultType, setResultType] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [refresh, setRefresh] = useState(0),
    [modal, setModal] = useState(null);
  const brands = context.brands.filter((b) => b.organization_id === org),
    active = data?.accounts.find((a) => a.id === account),
    report = data?.reports.find((r) => r.connection_id === account)?.payload;
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
      setError("Select a valid period of up to 94 days.");
      return;
    }
    Promise.all([
      adsService.read(org, brand, from, to),
      adsService.read(org, brand, range.from, range.to),
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
  }, [org, brand, from, to, refresh]);
  useEffect(() => {
    setPage(1);
  }, [level, parent, search, account, tab]);
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
    if(periodMode==="custom"||!active?.health?.timezone)return;
    const range=adsReportingPeriod(active.health.timezone,Number(periodMode));
    if(range){setFrom(range.from);setTo(range.to);}
  },[account,active?.health?.timezone,periodMode,reportingDay]);
  useEffect(() => {
    if(!org||!precedingPeriod(from,to))return;
    let cancelled=false,inFlight=false;
    const seq=generation.current;
    const timer=setInterval(async()=>{
      if(document.hidden||inFlight)return;
      const rolling=periodMode!=="custom"?adsReportingPeriod(active?.health?.timezone||"Asia/Kuala_Lumpur",Number(periodMode)):null;
      if(rolling&&(rolling.from!==from||rolling.to!==to)){setFrom(rolling.from);setTo(rolling.to);return;}
      inFlight=true;
      try {
        const range=precedingPeriod(from,to);
        const [current,before]=await Promise.all([adsService.read(org,brand,from,to),adsService.read(org,brand,range.from,range.to)]);
        if(!cancelled&&seq===generation.current){setData(current);setPrevious(before);setNotice(value=>value===pollError?"":value);}
      } catch {if(!cancelled&&seq===generation.current)setNotice(pollError);}
      finally {inFlight=false;}
    },30000);
    return()=>{cancelled=true;clearInterval(timer)};
  },[org,brand,from,to,refresh,periodMode,active?.health?.timezone]);
  function useAccount(a){setAccount(a.id);setModal(null);setTab("overview");setNotice("Using the existing shared Ad Account. Campaign brand attribution is preserved.");}
  const accountRows = (data?.accounts || []).map((a) => {
    const s = data.reports.find((r) => r.connection_id === a.id);
    return { ...a, summary: s?.payload.insights.account?.[0] };
  });
  const configs =
      report?.configs?.[
        level === "campaign"
          ? "campaigns"
          : level === "adset"
            ? "adsets"
            : "ads"
      ] || [],
    filtered = configs.filter(
      (r) =>
        (!parent ||
          r[level === "adset" ? "campaign_id" : "adset_id"] === parent) &&
        (!search || r.name.toLowerCase().includes(search.toLowerCase())),
    ),
    rows = filtered.slice((page - 1) * 20, page * 20);
  const resultTypes = [
    ...new Set(
      (report?.insights?.[level] || []).flatMap((r) =>
        (r.actions || []).map((a) => a.type),
      ),
    ),
  ];
  const beforeReport = previous?.reports.find(
    (r) => r.connection_id === account,
  )?.payload;
  const columns = [
    {
      key: "name",
      header: level === "adset" ? "Ad Set" : level === "ad" ? "Ad" : "Campaign",
      render: (r) => (
        <button
          className="text-left font-semibold"
          onClick={() => setModal({ kind: "detail", row: r, level })}
        >
          {r.name}
        </button>
      ),
    },
    {
      key: "feedx_brand",
      header: "FeedX brand",
      render: (r) => {
        const campaign =
          level === "campaign"
            ? r
            : report?.configs.campaigns.find((c) => c.id === r.campaign_id);
        return (
          context.brands.find((b) => b.id === campaign?.feedx_brand_id)?.name ||
          "Unassigned"
        );
      },
    },
    {
      key: "effective_status",
      header: "Meta status",
      render: (r) => <Badge>{r.effective_status || "Unavailable"}</Badge>,
    },
    ...Object.keys(adsMetricNames).map((key) => ({
      key,
      header: adsMetricNames[key],
      render: (r) =>
        adsMetric(
          insightFor(report, level, r.id)?.metrics[key],
          key,
          active?.health?.currency,
        ),
    })),
    ...["actions", "cost_per_action_type"].map((key) => ({
      key,
      header: key === "actions" ? "Results" : "Cost per Result",
      render: (r) => {
        const insight = insightFor(report, level, r.id),
          value = insight?.[key]?.find((a) => a.type === resultType)?.value;
        return value == null
          ? "—"
          : key === "actions"
            ? new Intl.NumberFormat("en-MY").format(value)
            : adsMetric({ value }, "spend", insight.currency);
      },
    })),
    {
      key: "drilldown",
      header: "Actions",
      render: (r) => (
        <div className="flex flex-wrap gap-2">
          {level !== "ad" && (
            <button
              className="btn-secondary"
              onClick={() => {
                setParent(r.id);
                setLevel(level === "campaign" ? "adset" : "ad");
              }}
            >
              View {level === "campaign" ? "Ad Sets" : "Ads"}
            </button>
          )}
          <a
            className="text-primary"
            href={adsManagerUrl(active?.account_id, r.id, level)}
            target="_blank"
            rel="noreferrer"
          >
            Ads Manager ↗
          </a>
        </div>
      ),
    },
  ];
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
          setParent("");
          setLevel("campaign");
        }}
      />
</div><AdminFilterToolbar compact denseFields ariaLabel="Ads date filters" secondaryActions={      <button
        className="btn-secondary"
        onClick={() => setRefresh((v) => v + 1)}
      >
        Refresh data
      </button>} periodAfterFilters period={<FeedXDateRangePicker from={from} to={to} today={adsReportingPeriod(active?.health?.timezone||"Asia/Kuala_Lumpur")?.to||today()} onApply={({from,to})=>{setPeriodMode("custom");setFrom(from);setTo(to)}}/>}>
      <SelectField
        label="Period"
        value={periodMode}
        onChange={(v) => {
          setPeriodMode(v);
          if(v==="custom")return;
          const range=adsReportingPeriod(active?.health?.timezone||"Asia/Kuala_Lumpur",Number(v));
          if(range){setFrom(range.from);setTo(range.to);}
        }}
        options={[
          { value: "custom", label: "Custom / historical" },
          { value: "30", label: "Last 30 days" },
          { value: "90", label: "Last 90 days" },
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
        can("marketing_ads.connect") && data?.organization_access !== false ? (
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
        onChange={setTab}
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
      {precedingPeriod(from, to) && (
        <p className="text-xs text-text-secondary">
          Compared with {precedingPeriod(from, to).from}–
          {precedingPeriod(from, to).to}. Reporting dates use each Meta account
          timezone. Maximum 94 days per synchronization.
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
        {data?.organization_access &&
          discoveries.map((d) => (
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
        {data?.organization_access &&
          !brand &&
          data?.reports?.map((r) => (
            <section className="ads-panel" key={`review:${r.connection_id}`}>
              <div className="flex flex-wrap justify-between items-center gap-3">
                <div>
                  <strong>{r.payload.account.name}</strong>
                  <p className="text-sm text-text-secondary">
                    {r.payload.configs.campaigns.length} campaigns ·
                    Campaign attribution review
                  </p>
                </div>
                <button
                  className="btn-secondary"
                  onClick={() =>
                    setModal({ kind: "preview", report: r.payload })
                  }
                >
                  Review campaign attribution
                </button>
              </div>
            </section>
          ))}
        {pending.map((session) => (
          <section key={session.id} className="ads-panel">
            <h2 className="font-semibold">Choose an authorized Ad Account</h2>
            <p className="text-sm text-text-secondary">
              Shared Ad Accounts can serve multiple authorized Brands. Read-only discovery
              creates no brand attribution or execution authority.
            </p>
            {!session.accounts.length ? (
              <p>No authorized Ad Accounts returned by Meta.</p>
            ) : (
              session.accounts.map((a) => (
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
        {!loading && data && !data.accounts.length ? (
          <EmptyState
            title={data.organization_access===false?"No confirmed brand advertising":"Connect your first Ad Account"}
            description={data.organization_access===false?"An authorized administrator can connect a shared Ad Account and confirm this brand’s campaigns.":"Discover shared Ad Accounts. Campaigns require explicit brand attribution."}
            actions={
              can("marketing_ads.connect") &&
              data?.organization_access !== false ? (
                <button
                  className="btn-secondary"
                  onClick={() => connect()}
                  disabled={busy}
                >
                  Connect Ad Account
                </button>
              ) : null
            }
          />
        ) : null}
        {tab === "overview" &&
          accountRows.map((a) => (
            <section className="ads-panel" key={a.id}>
              <div className="ads-account">
                <div>
                  <h2 className="font-semibold">{a.name}</h2>
                  <p className="text-sm text-text-secondary">
                    Shared account ·{" "}
                    {a.health?.currency || "Currency unavailable"} ·{" "}
                    {a.health?.timezone || "Timezone unavailable"}
                  </p>
                </div>
                <button
                  className="btn-secondary"
                  disabled={busy || !a.account_id || !data?.organization_access}
                  onClick={() =>
                    act(async () => {
                      await adsService.sync(a.id, from, to);
                      const before = precedingPeriod(from, to);
                      await adsService.sync(a.id, before.from, before.to);
                      setNotice(
                        "Reporting queued. This view updates automatically as synchronization completes.",
                      );
                    })
                  }
                >
                  Sync selected periods
                </button>
              </div>
              <ConnectionStatus account={a} report={data.reports.find(r=>r.connection_id===a.id)?.payload}/>
              <MetricGrid
                row={a.summary}
                previous={
                  previous?.reports.find((r) => r.connection_id === a.id)
                    ?.payload.insights.account?.[0]
                }
                currency={a.health?.currency}
              />
              {data.reports.some(r=>r.connection_id===a.id) && !a.summary && !Object.keys(data.reports.find(r=>r.connection_id===a.id)?.payload.warnings||{}).length && <p className="text-sm text-text-secondary">{brand?"No reporting rows are available for this brand. Campaigns must have explicit brand attribution; missing metrics are not zero.":"Meta returned no reporting rows for this period. Missing metrics remain unavailable."}</p>}
              {brand && data.organization_access && <button className="btn-secondary" onClick={()=>{setBrand("");setNotice("Choose Review campaign attribution to confirm only this brand’s campaigns. Shared account spend is never assigned automatically.");}}>Confirm campaign brands</button>}
              <Results row={a.summary} />
              <AdsPerformanceTrend
                report={
                  data.reports.find((r) => r.connection_id === a.id)?.payload
                }
              />
              <AdsReportingContext
                report={
                  data.reports.find((r) => r.connection_id === a.id)?.payload
                }
                brands={brands}
              />
              {!data.reports.some((r) => r.connection_id === a.id) && (
                <p className="text-sm">
                  Initial reporting starts automatically. Custom historical periods can be queued with Sync selected periods.
                </p>
              )}
              <p className="mt-3 text-xs text-text-secondary">Automatic refresh every six hours in {a.health?.timezone||"the Meta account timezone"}.{a.health?.next_sync_at?` Next scheduled check ${new Date(a.health.next_sync_at).toLocaleString()}.`:""}</p>
              <p className="mt-3 text-xs text-text-secondary">
                {a.last_synced_at
                  ? `Last sync ${new Date(a.last_synced_at).toLocaleString()}`
                  : "No successful synchronization yet."}
              </p>
            </section>
          ))}
        {tab === "accounts" &&
          accountRows.map((a) => (
            <section className="ads-panel" key={a.id}>
              <div className="ads-account">
                <div>
                  <h2 className="font-semibold">{a.name}</h2>
                  <p className="text-sm">
                    Shared account · {a.account_id || "Disconnected"} ·{" "}
                    {a.health?.currency} · {a.health?.timezone}
                  </p>
                </div>
                <ConnectionStatus account={a} report={data.reports.find(r=>r.connection_id===a.id)?.payload}/>
              </div>
              <dl className="ads-metrics">
                <div>
                  <dt>Reporting</dt>
                  <dd>{a.health?.read_verified ? "Verified" : "Unverified"}</dd>
                </div>
                <div>
                  <dt>Management authority</dt>
                  <dd>
                    {adsManagementReason(a.health)}
                  </dd>
                </div>
                <div>
                  <dt>Last verified</dt>
                  <dd className="text-sm">
                    {a.health?.checked_at
                      ? new Date(a.health.checked_at).toLocaleString()
                      : "Unavailable"}
                  </dd>
                </div>
              </dl>
              {a.health?.sync_error && (
                <p className="text-sm text-text-secondary">
                  Reporting needs attention. Check Meta access and account
                  health, then retry synchronization.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {can("marketing_ads.connect") &&
                  data?.organization_access !== false && (
                    <>
                      <button
                        className="btn-secondary"
                        disabled={busy}
                        onClick={() => connect(true)}
                      >
                        Reconnect
                      </button>
                      <button
                        className="btn-secondary"
                        disabled={busy || !a.account_id || !data?.organization_access}
                        onClick={() => setModal({ kind: "disconnect", a })}
                      >
                        Disconnect
                      </button>
                    </>
                  )}
                <button
                  className="btn-secondary"
                  disabled={busy || !a.account_id || !data?.organization_access}
                  onClick={() => act(() => adsService.sync(a.id, from, to))}
                >
                  Retry reporting
                </button>
                <a
                  className="btn-secondary"
                  href={adsManagerUrl(a.account_id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ads Manager ↗
                </a>
              </div>
            </section>
          ))}
        {tab === "campaigns" && data?.accounts.length > 0 && (
          <>
            <AdminFilterToolbar compact denseFields ariaLabel="Advertising filters">
              <SelectField
                label="Result type"
                value={resultType}
                onChange={setResultType}
                options={[
                  { value: "", label: "Select Meta action" },
                  ...resultTypes.map((value) => ({
                    value,
                    label: value.replaceAll("_", " "),
                  })),
                ]}
              />
              <SelectField
                label="Ad Account"
                value={account}
                options={data.accounts.map((a) => ({
                  value: a.id,
                  label: a.name,
                }))}
                onChange={(v) => {
                  setAccount(v);
                  setParent("");
                }}
              />
              <SelectField
                label="Level"
                value={level}
                options={[
                  { value: "campaign", label: "Campaigns" },
                  { value: "adset", label: "Ad Sets" },
                  { value: "ad", label: "Ads" },
                ]}
                onChange={(v) => {
                  setLevel(v);
                  setParent("");
                }}
              />
              <AdminSearchField
                label="Search advertising"
                value={search}
                onChange={setSearch}
                placeholder="Search names"
              />
              {parent && (
                <button className="btn-secondary" onClick={() => setParent("")}>
                  Show all
                </button>
              )}
            </AdminFilterToolbar>
            <ConnectionStatus account={active} report={report}/>
            {!report ? (
              <EmptyState
                title="Advertising data not synchronized"
                description="Initial reporting is automatic after confirmation. This view updates as jobs finish; custom historical periods can be synced from Overview."
              />
            ) : !filtered.length ? (
              <EmptyState
                title="No matching advertising"
                description="Meta returned no matching records. Adjust the filters or open Ads Manager."
              />
            ) : (
              <>
                <div className="ads-desktop">
                  <DataTable
                    columns={columns}
                    rows={rows}
                    getRowKey={(r) => r.id}
                    density="compact"
                    minWidth={1180}
                  />
                </div>
                <div className="ads-mobile">
                  {rows.map((r) => (
                    <article key={r.id} className="ads-panel">
                      <button
                        className="font-semibold text-left"
                        onClick={() =>
                          setModal({ kind: "detail", row: r, level })
                        }
                      >
                        {r.name}
                      </button>
                      <p>{r.effective_status || "Unavailable"}</p>
                      <MetricGrid
                        row={insightFor(report, level, r.id)}
                        previous={insightFor(beforeReport, level, r.id)}
                        currency={active?.health?.currency}
                      />
                      {resultType && (
                        <dl className="ads-metrics">
                          {columns
                            .filter((c) =>
                              ["actions", "cost_per_action_type"].includes(
                                c.key,
                              ),
                            )
                            .map((c) => (
                              <div key={c.key}>
                                <dt>
                                  {c.header} · {resultType.replaceAll("_", " ")}
                                </dt>
                                <dd>{c.render(r)}</dd>
                              </div>
                            ))}
                        </dl>
                      )}
                      <a
                        className="text-sm text-primary"
                        href={adsManagerUrl(active?.account_id, r.id, level)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ads Manager ↗
                      </a>
                      {level !== "ad" && (
                        <button
                          className="btn-secondary"
                          onClick={() => {
                            setParent(r.id);
                            setLevel(level === "campaign" ? "adset" : "ad");
                          }}
                        >
                          View {level === "campaign" ? "Ad Sets" : "Ads"}
                        </button>
                      )}
                    </article>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    {filtered.length} records · Page {page}
                  </span>
                  <div className="flex gap-2">
                    <button
                      className="btn-secondary"
                      disabled={page === 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </button>
                    <button
                      className="btn-secondary"
                      disabled={page * 20 >= filtered.length}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
            {report?.warnings && Object.keys(report.warnings).length > 0 && (
              <p className="text-sm text-text-secondary">
                Some insights are unavailable. Configuration synchronized
                successfully.
              </p>
            )}
            {report?.insights?.daily?.length > 0 && (
              <details className="ads-panel">
                <summary>
                  Daily performance · {active?.health?.timezone}
                </summary>
                <div className="overflow-x-auto">
                  <DataTable
                    minWidth={500}
                    density="compact"
                    columns={[
                      { key: "date_start", header: "Date" },
                      ...["spend", "impressions", "ctr"].map((k) => ({
                        key: k,
                        header: adsMetricNames[k],
                        render: (r) =>
                          adsMetric(r.metrics[k], k, active?.health?.currency),
                      })),
                    ]}
                    rows={report.insights.daily}
                    getRowKey={(r) => r.date_start}
                  />
                </div>
              </details>
            )}
          </>
        )}
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
            {modal.report.account.timezone}. Reporting period{" "}
            {modal.report.date_from}–{modal.report.date_to}. Meta configuration
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
