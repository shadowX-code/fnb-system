import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext.jsx";
import WorkspacePage from "../../components/layout/WorkspacePage.jsx";
import AdminFilterToolbar from "../../components/layout/AdminFilterToolbar.jsx";
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
import "./ads.css";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const defaultStart = () =>
  new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
function MetricGrid({ row, previous, currency }) {
  return (
    <dl className="ads-metrics">
      {Object.entries(adsMetricNames).map(([key, label]) => (
        <div key={key}>
          <dt>
            {label}
            {row?.metrics?.[key]?.state === "estimated" ? " · estimated" : ""}
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
    [data, setData] = useState(null),
    [previous, setPrevious] = useState(null),
    [pending, setPending] = useState([]),
    [tab, setTab] = useState("overview"),
    [account, setAccount] = useState(""),
    [level, setLevel] = useState("campaign"),
    [parent, setParent] = useState(""),
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
  useEffect(() => {
    let live = true;
    marketingService
      .context()
      .then((c) => {
        if (!live) return;
        setContext(c);
        const query = new URLSearchParams(location.search),
          o = query.get("marketing_org");
        setOrg(
          c.organizations.some((x) => x.id === o)
            ? o
            : c.organizations[0]?.id || "",
        );
        const b = query.get("marketing_brand");
        if (c.brands.some((x) => x.id === b)) setBrand(b);
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
    const range = precedingPeriod(from, to);
    if (!range) {
      setLoading(false);
      setError("Select a valid period of up to 94 days.");
      return;
    }
    Promise.all([
      adsService.read(org, brand, from, to),
      adsService.read(org, brand, range.from, range.to),
      brand && can("marketing_ads.connect")
        ? adsService.pending(org, brand)
        : Promise.resolve([]),
    ])
      .then(([current, before, sessions]) => {
        if (seq !== generation.current) return;
        setData(current);
        setPrevious(before);
        setPending(sessions);
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
  async function connect() {
    if (!brand) {
      setNotice("Select the FeedX brand that will own this Ad Account.");
      return;
    }
    await act(async () => {
      const result = await adsService.authorize(org, brand);
      location.assign(result.authorization_url);
    });
  }
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
      key: "effective_status",
      header: "Meta status",
      render: (r) => <Badge>{r.effective_status || "Unavailable"}</Badge>,
    },
    ...["spend", "impressions", "ctr", "cpc"].map((key) => ({
      key,
      header: adsMetricNames[key],
      render: (r) =>
        adsMetric(
          insightFor(report, level, r.id)?.metrics[key],
          key,
          active?.health?.currency,
        ),
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
    <AdminFilterToolbar>
      <SelectField
        label="Organization"
        value={org}
        options={context.organizations.map((o) => ({
          value: o.id,
          label: o.name,
        }))}
        onChange={(v) => {
          setOrg(v);
          setBrand("");
        }}
      />
      <SelectField
        label="Brand"
        value={brand}
        options={[
          { value: "", label: "All permitted brands" },
          ...brands.map((b) => ({ value: b.id, label: b.name })),
        ]}
        onChange={setBrand}
      />
      <label className="ads-date">
        From
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label className="ads-date">
        To
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
    </AdminFilterToolbar>
  );
  return (
    <WorkspacePage
      section="Marketing"
      title="Ads & Analytics"
      description="Advertising performance and decisions across your brands."
      controls={controls}
      actions={
        can("marketing_ads.connect") ? (
          <button
            className="btn-primary"
            disabled={busy || !org}
            onClick={connect}
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
        ]}
      />
      {notice && (
        <p role="status" className="text-sm text-text-secondary">
          {notice}
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
            title="No Marketing organization"
            description="An administrator must grant organization and brand access."
          />
        ) : null}
        {pending.map((session) => (
          <section key={session.id} className="ads-panel">
            <h2 className="font-semibold">Choose an authorized Ad Account</h2>
            <p className="text-sm text-text-secondary">
              Confirm ownership by {brands.find((b) => b.id === brand)?.name}.
              Connecting keeps advertising execution disabled.
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
                    onClick={() => setModal({ kind: "bind", session, a })}
                  >
                    {a.available ? "Select" : "Assigned to another brand"}
                  </button>
                </div>
              ))
            )}
          </section>
        ))}
        {!loading && data && !data.accounts.length ? (
          <EmptyState
            title="Connect your first Ad Account"
            description="Select a brand, authorize Meta account discovery, then confirm the exact account. Page connections do not grant advertising access."
            actions={
              can("marketing_ads.connect") ? (
                <button
                  className="btn-secondary"
                  onClick={connect}
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
                    {context.brands.find((b) => b.id === a.brand_id)?.name} ·{" "}
                    {a.health?.currency || "Currency unavailable"} ·{" "}
                    {a.health?.timezone || "Timezone unavailable"}
                  </p>
                </div>
                <button
                  className="btn-secondary"
                  disabled={busy || !a.account_id}
                  onClick={() =>
                    act(async () => {
                      await adsService.sync(a.id, from, to);
                      const before = precedingPeriod(from, to);
                      await adsService.sync(a.id, before.from, before.to);
                      setNotice(
                        "Reporting queued. Refresh after synchronization completes.",
                      );
                    })
                  }
                >
                  Sync selected periods
                </button>
              </div>
              <MetricGrid
                row={a.summary}
                previous={
                  previous?.reports.find((r) => r.connection_id === a.id)
                    ?.payload.insights.account?.[0]
                }
                currency={a.health?.currency}
              />
              <Results row={a.summary} />
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
                    {context.brands.find((b) => b.id === a.brand_id)?.name} ·{" "}
                    {a.account_id || "Disconnected"} · {a.health?.currency} ·{" "}
                    {a.health?.timezone}
                  </p>
                </div>
                <Badge>
                  {a.status === "not_connected"
                    ? "Disconnected"
                    : a.status === "expired" ||
                        Date.parse(a.expires_at) <= Date.now()
                      ? "Expired"
                      : a.health?.read_verified
                        ? "Connected"
                        : "Action required"}
                </Badge>
              </div>
              <dl className="ads-metrics">
                <div>
                  <dt>Reporting</dt>
                  <dd>{a.health?.read_verified ? "Verified" : "Unverified"}</dd>
                </div>
                <div>
                  <dt>Management authority</dt>
                  <dd>
                    {a.health?.manage_verified
                      ? "Verified; execution disabled"
                      : "Permission or account task required"}
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
                {can("marketing_ads.connect") && (
                  <>
                    <button
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => {
                        setBrand(a.brand_id);
                        setNotice(
                          "Brand selected. Connect and choose this same Ad Account to renew authorization.",
                        );
                      }}
                    >
                      Reconnect
                    </button>
                    <button
                      className="btn-secondary"
                      disabled={busy || !a.account_id}
                      onClick={() => setModal({ kind: "disconnect", a })}
                    >
                      Disconnect
                    </button>
                  </>
                )}
                <button
                  className="btn-secondary"
                  disabled={busy || !a.account_id}
                  onClick={() => act(() => adsService.sync(a.id, from, to))}
                >
                  Refresh status
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
            <AdminFilterToolbar>
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
              <input
                className="input"
                aria-label="Search advertising"
                placeholder="Search names"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {parent && (
                <button className="btn-secondary" onClick={() => setParent("")}>
                  Show all
                </button>
              )}
            </AdminFilterToolbar>
            {!report ? (
              <EmptyState
                title="Advertising data not synchronized"
                description="Queue synchronization from Overview to load actual Meta configuration and reporting."
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
                    minWidth={760}
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
                        currency={active?.health?.currency}
                      />
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
        {tab === "copilot" && (
          <EmptyState
            title="AI Ads Copilot — advisory only"
            description="Recommendations require an authorized Ad Account, verified performance and approved Brand Knowledge. Provider execution will be configured after read-only acceptance; AI cannot activate ads or change budgets."
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
                    data?.accounts.find((a) => a.account_id === modal.a.id)
                      ?.generation ?? null,
                  );
                  setModal(null);
                  setNotice(
                    "Ad Account connected. External execution remains disabled.",
                  );
                })
              }
            >
              Confirm connection
            </button>
          }
        >
          <p>
            Connect <strong>{modal.a.name}</strong> ({modal.a.id}) to{" "}
            <strong>{brands.find((b) => b.id === brand)?.name}</strong>?
          </p>
          <p className="mt-3 text-sm text-text-secondary">
            Reporting and account-management permissions are verified
            independently. This does not authorize advertising spend.
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
              Meta owns configuration and delivery. FeedX external execution is
              disabled.
            </p>
          </div>
        </Modal>
      )}
    </WorkspacePage>
  );
}
