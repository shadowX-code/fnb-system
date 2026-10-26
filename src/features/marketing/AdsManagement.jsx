import { useEffect, useRef, useState } from "react";
import { marketingService } from "./marketingService.js";
import { adsService } from "./adsService.js";
import { adsManagerUrl } from "./adsPresentation.js";
import CreateAdWorkspace from "./CreateAdWorkspace.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
import AdminFormField from "../../components/forms/AdminFormField.jsx";
import DatePickerField from "../../components/forms/DatePickerField.jsx";
import TimePickerField from "../../components/forms/TimePickerField.jsx";
import Modal from "../../components/feedback/Modal.jsx";
import Badge from "../../components/ui/Badge.jsx";
import EmptyState from "../../components/feedback/EmptyState.jsx";
import DataTable from "../../components/tables/DataTable.jsx";
import AsyncDataSurface from "../../components/feedback/AsyncDataSurface.jsx";
import { adsManagementReason } from "./adsReadiness.js";
const money = (v) =>
  new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(
    v / 100,
  );
const initial = () => ({
  operation: "create",
  name: "",
  objective: "OUTCOME_TRAFFIC",
  budget: "",
  start_date: "",
  start_clock: "09:00",
  end_date: "",
  end_clock: "18:00",
  age_min: "18",
  age_max: "65",
  placements: "facebook_feed",
  asset_id: "",
  page_id: "",
  caption: "",
  headline: "",
  url: "",
  campaign_id: "",
  resume_scope: "campaign",
  universal_beneficiary: "",
  universal_payer: "",
});
export default function AdsManagement({
  org,
  createRequest = 0,
  showCreateAction = true,
  brand,
  brands,
  accounts: reportingAccounts,
  report,
  can,
}) {
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [modal, setModal] = useState(null),
    [form, setForm] = useState(initial),
    [selectedBrand, setSelectedBrand] = useState(brand),
    [connection, setConnection] = useState(reportingAccounts[0]?.id || ""),
    [enabled, setEnabled] = useState(false),
    [managementLoginReady, setManagementLoginReady] = useState(false);
  const accounts = (data?.accounts?.length ? data.accounts : reportingAccounts).map(a=>({...a,health:reportingAccounts.find(r=>r.id===a.id)?.health||a.health}));
  const sequence = useRef(0),
    intent = useRef(null), createdRequest=useRef(0), actionPending=useRef(false);
  useEffect(() => {
    const n = ++sequence.current;
    setLoading(true);
    setData(null);
    setModal(null);
    setError("");
    setSelectedBrand(brand);
    Promise.all([adsService.changes(org, brand), adsService.aiCapabilities()])
      .then(([r, c]) => {
        if (n === sequence.current) {
          setData(r);
          setConnection((value) =>
            [...(r.accounts || []), ...reportingAccounts].some(
              (a) => a.id === value,
            )
              ? value
              : r.accounts?.[0]?.id || reportingAccounts[0]?.id || "",
          );
          setEnabled(c.external_execution_enabled === true);
          setManagementLoginReady(c.management_login_ready === true);
        }
      })
      .catch((e) => {
        if (n === sequence.current) setError(e.message);
      })
      .finally(() => {
        if (n === sequence.current) setLoading(false);
      });
    return () => {
      sequence.current++;
    };
  }, [org, brand, refresh]);
  useEffect(()=>{if(data && createRequest>createdRequest.current){createdRequest.current=createRequest;setModal({kind:"create"});}},[data,createRequest]);
  const edit = (k, v) => {
    intent.current = null;
    setForm((f) => ({ ...f, [k]: v }));
  };
  const active = accounts.find((a) => a.id === connection),
    pages = (data?.pages || []).filter((p) => p.brand_id === selectedBrand),
    assets = (data?.assets || []).filter((a) => a.brand_id === selectedBrand);
  async function act(fn) {
    if (actionPending.current) return;
    actionPending.current = true;
    const n = sequence.current;
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      if (n === sequence.current) {
        setModal(null);
        setRefresh((x) => x + 1);
      }
      return r;
    } catch (e) {
      if (n === sequence.current) {
        setError(e.message);
        setModal(m=>m?.kind === "detail" ? {...m,execution:null} : m);
      }
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }
  async function inspectRevision(kind) {
    if (actionPending.current || modal?.kind !== "detail") return;
    actionPending.current = true;
    const n = sequence.current, row = modal.row;
    setBusy(true);setError("");
    setModal(m=>m?.kind === "detail" && m.row.id === row.id && m.row.fingerprint === row.fingerprint ? {...m,[kind]:null} : m);
    try {
      const result = kind === "execution" ? await adsService.executionStatus(row) : await adsService.createReadiness({organizationId:org,brandId:row.brand_id,connectionId:row.connection_id,requestId:row.id,fingerprint:row.fingerprint});
      if (n !== sequence.current) return;
      if (kind === "execution" && (result.request_id !== row.id || result.fingerprint !== row.fingerprint || result.operation !== row.operation)) throw new Error("Authorization changed. Reopen the current revision.");
      setModal(m=>m?.kind === "detail" && m.row.id === row.id && m.row.fingerprint === row.fingerprint ? {...m,[kind]:kind === "execution" ? result : result.message} : m);
    } catch(e) {if(n === sequence.current)setError(e.message);}
    finally {actionPending.current=false;setBusy(false);}
  }
  const campaigns = (report?.configs?.campaigns || []).filter(
    (c) => c.feedx_brand_id === selectedBrand,
  );
  async function prepare(e) {
    e.preventDefault();
    const config =
      form.operation === "create"
        ? {
            name: form.name.trim(),
            objective: form.objective,
            maximum_budget: Math.round(Number(form.budget) * 100),
            start_time: `${form.start_date}T${form.start_clock}:00+08:00`,
            end_time: `${form.end_date}T${form.end_clock}:00+08:00`,
            age_min: Number(form.age_min),
            age_max: Number(form.age_max),
            placements: form.placements,
            asset_id: form.asset_id,
            page_id: form.page_id,
            adset_contract_version: 2,
            regional_regulated_categories: ["MALAYSIA_UNIVERSAL"],
            regional_regulation_identities: {
              universal_beneficiary: form.universal_beneficiary.trim(),
              universal_payer: form.universal_payer.trim(),
            },
            ...(form.objective === "OUTCOME_AWARENESS"
              ? { promoted_object: { page_id: form.page_id } }
              : {}),
            ...(form.placements !== "facebook_feed"
              ? {
                  instagram_id: pages.find((p) => p.page_id === form.page_id)
                    ?.instagram_id,
                }
              : {}),
            caption: form.caption.trim(),
            headline: form.headline.trim(),
            url: form.url.trim(),
          }
        : {
            campaign_id: form.campaign_id,
            ...(form.operation === "resume"
              ? { resume_scope: form.resume_scope }
              : {}),
            ...(form.operation === "budget"
              ? { maximum_budget: Math.round(Number(form.budget) * 100) }
              : {}),
          };
    intent.current ||= crypto.randomUUID();
    const prepared = await act(() =>
      adsService.prepareChange({
        requestId: intent.current,
        organizationId: org,
        brandId: selectedBrand,
        connectionId: connection,
        operation: form.operation,
        configuration: config,
        previousId: modal?.previous?.id || null,
      }),
    );
    if (prepared)
      setNotice(
        "Revision prepared. Review and approval do not enable external execution.",
      );
  }
  function openNew() {
    intent.current = null;
    setForm({...initial(),operation:"pause"});
    setModal({ kind: "form" });
    setNotice("");
  }
  function revise(r) {
    if(r.operation==="create" && r.state!=="reconciling" && !r.configuration.recovery_source){setModal({kind:"create",previous:r});return;}

    const c = r.configuration;
    intent.current = null;
    setSelectedBrand(r.brand_id);
    setConnection(r.connection_id);
    setForm({
      ...initial(),
      ...c,
      universal_beneficiary:
        c.regional_regulation_identities?.universal_beneficiary || "",
      universal_payer: c.regional_regulation_identities?.universal_payer || "",
      operation: r.operation,
      budget: r.maximum_budget ? String(r.maximum_budget / 100) : "",
      start_date: c.start_time?.slice(0, 10) || "",
      start_clock: c.start_time?.slice(11, 16) || "09:00",
      end_date: c.end_time?.slice(0, 10) || "",
      end_clock: c.end_time?.slice(11, 16) || "18:00",
    });
    setModal({ kind: "form", previous: r });
  }
  const list = (data?.changes || []).map((r) => ({
    ...r,
    brand: brands.find((b) => b.id === r.brand_id)?.name || "Brand",
    name:
      r.configuration.name ||
      report?.configs?.campaigns?.find(
        (c) => c.id === r.configuration.campaign_id,
      )?.name ||
      "Campaign change",
  }));
  const rowButtons = (r) => (
    <div className="flex flex-wrap gap-2">
      <button
        className="btn-secondary"
        onClick={() => setModal({ kind: "detail", row: r })}
      >
        Review revision
      </button>
      {can("marketing_ads.manage") &&
        (["draft", "review", "approved", "failed", "stale"].includes(r.state) ||
          (r.state === "reconciling" &&
            r.operation === "create" &&
            r.provider_state?.pending === "adset")) && (
          <button className="btn-secondary" onClick={() => revise(r)}>
            {r.state === "reconciling"
              ? "Prepare declaration revision"
              : "Revise"}
          </button>
        )}
    </div>
  );
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Ads workspace</h2>
          <p className="text-sm text-text-secondary">
            Prepare, review and approve exact changes. AI recommendations stay
            advisory.
          </p>
        </div>
        <button
          className="btn-secondary"
          disabled={busy}
          onClick={() => setRefresh((x) => x + 1)}
        >
          Refresh revisions
        </button>
        {can("marketing_ads.manage") && (
          <button
            className="btn-primary"
            disabled={!accounts.length || busy}
            onClick={openNew}
          >
            Manage campaign
          </button>
        )}
      </div>
      <p className="text-sm text-text-secondary">
        {!enabled ? "Execution requires separate authorization for the approved revision. " : ""}
        Creation starts paused. Each activation and budget adjustment requires
        its own reviewed approval.
      </p>
      {accounts.filter(a=>!a.health?.manage_verified).map(a=><p key={a.id} className="text-sm text-text-secondary">{a.name}: {adsManagementReason(a.health)}</p>)}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <AsyncDataSurface
        loading={loading}
        error={error}
        onRetry={() => setRefresh((x) => x + 1)}
        hasData={!!data}
      >
        {!list.length ? (
          <EmptyState
            title="No advertising revisions"
            description="Prepare a bounded campaign or an explicitly attributed campaign change."
          />
        ) : (
          <>
            <div className="ads-desktop">
              <DataTable
                density="compact"
                minWidth={800}
                rows={list}
                getRowKey={(r) => r.id}
                columns={[
                  { key: "name", header: "Change" },
                  { key: "brand", header: "Brand" },
                  { key: "operation", header: "Operation" },
                  { key: "revision", header: "Revision" },
                  {
                    key: "state",
                    header: "Status",
                    render: (r) => (
                      <Badge>
                        {!r.current &&
                        ["draft", "review", "approved"].includes(r.state)
                          ? "Needs new revision"
                          : r.state}
                      </Badge>
                    ),
                  },
                  {
                    key: "maximum_budget",
                    header: "Maximum lifetime budget",
                    render: (r) =>
                      r.configuration.draft_only ? "Draft — not validated" : r.operation === "pause"
                        ? "No budget change"
                        : money(r.maximum_budget),
                  },
                  { key: "actions", header: "Actions", render: rowButtons },
                ]}
              />
            </div>
            <div className="ads-mobile">
              {list.map((r) => (
                <article className="ads-panel space-y-2" key={r.id}>
                  <h3 className="font-semibold">{r.name}</h3>
                  <p>
                    {r.brand} · {r.operation} · Revision {r.revision}
                  </p>
                  <Badge>{r.state}</Badge>
                  <p>
                    {r.configuration.draft_only ? "Draft — not validated" : r.operation === "pause"
                      ? "No budget change"
                      : money(r.maximum_budget)}
                  </p>
                  {rowButtons(r)}
                </article>
              ))}
            </div>
          </>
        )}
      </AsyncDataSurface>
      {showCreateAction && can("marketing_ads.manage") && <button className="btn-primary" disabled={loading||busy} onClick={()=>setModal({kind:"create"})}>Create Ad</button>}
      {modal?.kind === "create" && <CreateAdWorkspace key={modal.previous?.id||"new"} managementLoginReady={managementLoginReady} canConnect={can("marketing_ads.connect")} org={org} brand={brand} brands={brands} accounts={accounts} data={data||{}} previous={modal.previous} onClose={()=>setModal(null)} onSave={async(body)=>{const n=sequence.current;const row=await adsService.prepareChange(body);if(n!==sequence.current)return row;setModal(null);setNotice(body.configuration.draft_only?"Ad draft saved. No provider changes were made.":"Ad revision prepared. Review and approval are required; nothing was sent to Meta.");setRefresh(n=>n+1);return row;}}/>}
      {modal?.kind === "form" && (
        <Modal
          title={
            modal.previous
              ? modal.previous.state === "reconciling"
                ? "Prepare declaration revision"
                : "Prepare superseding revision"
              : "Prepare advertising change"
          }
          size="3xl"
          onClose={() => !busy && setModal(null)}
        >
          <form onSubmit={prepare} className="space-y-4">
            {modal.previous?.state === "reconciling" && (
              <p className="text-sm text-text-secondary">
                Only advertiser declarations may change. The existing Campaign,
                budget, schedule and creative are preserved. This saves a
                validation proposal and leaves the original Reconciling revision
                unchanged.
              </p>
            )}
            {error && (
              <p role="alert" className="text-error">
                {error}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SelectField
                label="FeedX brand"
                required
                value={selectedBrand}
                disabled={busy || !!modal.previous}
                options={brands.map((b) => ({ value: b.id, label: b.name }))}
                onChange={(v) => {
                  setSelectedBrand(v);
                  edit("page_id", "");
                  edit("asset_id", "");
                  edit("campaign_id", "");
                  edit("universal_beneficiary", "");
                  edit("universal_payer", "");
                }}
              />
              <SelectField
                label="Shared Ad Account"
                required
                value={connection}
                disabled={busy || !!modal.previous}
                options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                onChange={(v) => {
                  setConnection(v);
                  edit("universal_beneficiary", "");
                  edit("universal_payer", "");
                  intent.current = null;
                }}
              />
              <SelectField
                label="Change"
                value={form.operation}
                options={[
                  ...(modal.previous?.operation==="create"?[{ value: "create", label: "Create paused campaign" }]:[]),
                  { value: "pause", label: "Pause campaign" },
                  { value: "resume", label: "Resume bounded campaign" },
                  { value: "budget", label: "Adjust lifetime budget" },
                ]}
                onChange={(v) => edit("operation", v)}
              />
            </div>
            <p className="text-xs text-text-secondary">
              {active?.health?.currency} · {active?.health?.timezone}. Native
              creation supports Malaysia audiences, Awareness/Website Traffic,
              feed placements and image link ads. Advanced objectives, daily
              budgets, special categories and other creatives use{" "}
              <a
                href={adsManagerUrl(active?.account_id)}
                target="_blank"
                rel="noreferrer"
                className="text-primary"
              >
                Ads Manager ↗
              </a>
              .
            </p>
            {form.operation === "create" ? (
              <>
                <fieldset className="ads-panel space-y-3">
                  <legend className="font-semibold">
                    Malaysia advertiser declaration
                  </legend>
                  <p className="text-sm text-text-secondary">
                    Explicitly choose the verified advertiser (beneficiary) and
                    payer for this Ad Set. Enter their Meta verified identity
                    IDs; Page IDs and company names are not identity IDs. Meta
                    must validate them before recovery approval.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[
                      [
                        "universal_beneficiary",
                        "Advertiser (beneficiary) identity ID",
                      ],
                      ["universal_payer", "Payer identity ID"],
                    ].map(([key, label]) => (
                      <AdminFormField key={key} label={label}>
                        <input
                          className="control"
                          required
                          inputMode="numeric"
                          pattern="[0-9]{1,30}"
                          maxLength={30}
                          value={form[key]}
                          onChange={(e) => edit(key, e.target.value)}
                        />
                      </AdminFormField>
                    ))}
                  </div>
                  <p className="text-xs text-text-secondary">
                    No automatic identity selection. A numeric ID alone does not
                    establish verification.
                  </p>
                </fieldset>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <AdminFormField label="Campaign name">
                    <input
                      className="control"
                      required
                      maxLength={150}
                      value={form.name}
                      onChange={(e) => edit("name", e.target.value)}
                    />
                  </AdminFormField>
                  <SelectField
                    label="Objective"
                    value={form.objective}
                    options={[
                      { value: "OUTCOME_TRAFFIC", label: "Website Traffic" },
                      { value: "OUTCOME_AWARENESS", label: "Awareness" },
                    ]}
                    onChange={(v) => edit("objective", v)}
                  />
                  <SelectField
                    required
                    label="Brand Page"
                    value={form.page_id}
                    options={pages.map((p) => ({
                      value: p.page_id,
                      label: p.name,
                    }))}
                    onChange={(v) => edit("page_id", v)}
                  />
                  <SelectField
                    label="Placements"
                    value={form.placements}
                    options={[
                      { value: "facebook_feed", label: "Facebook Feed" },
                      {
                        value: "instagram_feed",
                        label: "Instagram Feed",
                        disabled: !pages.find((p) => p.page_id === form.page_id)
                          ?.instagram_id,
                      },
                      {
                        value: "both_feeds",
                        label: "Facebook + Instagram Feed",
                        disabled: !pages.find((p) => p.page_id === form.page_id)
                          ?.instagram_id,
                      },
                    ]}
                    onChange={(v) => edit("placements", v)}
                  />
                  <SelectField
                    required
                    label="Brand image"
                    value={form.asset_id}
                    options={assets.map((a) => ({
                      value: a.id,
                      label: a.filename,
                    }))}
                    onChange={(v) => edit("asset_id", v)}
                  />
                  <AdminFormField label="Destination URL">
                    <input
                      className="control"
                      required
                      type="url"
                      pattern="https://.*"
                      value={form.url}
                      onChange={(e) => edit("url", e.target.value)}
                    />
                  </AdminFormField>
                  <AdminFormField label="Minimum age">
                    <input
                      className="control"
                      type="number"
                      min={18}
                      max={65}
                      value={form.age_min}
                      onChange={(e) => edit("age_min", e.target.value)}
                    />
                  </AdminFormField>
                  <AdminFormField label="Maximum age">
                    <input
                      className="control"
                      type="number"
                      min={18}
                      max={65}
                      value={form.age_max}
                      onChange={(e) => edit("age_max", e.target.value)}
                    />
                  </AdminFormField>
                  <DatePickerField
                    required
                    label="Starts · Asia/Singapore"
                    value={form.start_date}
                    onChange={(v) => edit("start_date", v)}
                  />
                  <TimePickerField
                    label="Start time"
                    value={form.start_clock}
                    onChange={(v) => edit("start_clock", v)}
                  />
                  <DatePickerField
                    required
                    label="Ends · Asia/Singapore"
                    value={form.end_date}
                    onChange={(v) => edit("end_date", v)}
                  />
                  <TimePickerField
                    label="End time"
                    value={form.end_clock}
                    onChange={(v) => edit("end_clock", v)}
                  />
                </div>
                <AdminFormField label="Headline">
                  <input
                    className="control"
                    required
                    maxLength={120}
                    value={form.headline}
                    onChange={(e) => edit("headline", e.target.value)}
                  />
                </AdminFormField>
                <AdminFormField label="Caption">
                  <textarea
                    className="control min-h-24"
                    required
                    maxLength={2200}
                    value={form.caption}
                    onChange={(e) => edit("caption", e.target.value)}
                  />
                </AdminFormField>
              </>
            ) : (
              <SelectField
                label="Confirmed brand campaign"
                required
                value={form.campaign_id}
                options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
                onChange={(v) => edit("campaign_id", v)}
              />
            )}
            {form.operation === "resume" && (
              <SelectField
                label="Activation scope"
                value={form.resume_scope}
                options={[
                  {
                    value: "campaign",
                    label: "Campaign only · keep child statuses",
                  },
                  {
                    value: "feedx_hierarchy",
                    label: "FeedX-created Campaign + Ad Set + Ad",
                  },
                ]}
                onChange={(v) => edit("resume_scope", v)}
              />
            )}
            {["create", "budget"].includes(form.operation) && (
              <AdminFormField label="Maximum lifetime budget · MYR">
                <input
                  className="control"
                  required
                  type="number"
                  min="0.01"
                  max="9999999.99"
                  step="0.01"
                  value={form.budget}
                  onChange={(e) => edit("budget", e.target.value)}
                />
              </AdminFormField>
            )}
            <p className="text-xs text-text-secondary">
              No advertising changes are sent during preparation. A revised
              creative, budget, account or scope invalidates previous approval.
              Budgets exclude tax and platform fees; Meta validation and
              delivery policies still apply.
            </p>
            <button
              className="btn-primary"
              disabled={busy || !selectedBrand || !connection}
            >
              {busy ? "Preparing…" : "Save revision"}
            </button>
          </form>
        </Modal>
      )}
      {modal?.kind === "detail" && (
        <Modal
          title={modal.row.name}
          placement="right"
          onClose={() => !busy && setModal(null)}
        >
          <RevisionDetail
            row={modal.row}
            can={can}
            manage={
              accounts.find((a) => a.id === modal.row.connection_id)?.health
                ?.manage_verified
            }
            busy={busy}
            error={error}
            onTransition={(action) =>
              act(() => adsService.transitionChange(modal.row, action))
            }
            onExecute={() => act(() => adsService.executeChange(modal.row))}
            onCheckExecution={() => inspectRevision("execution")}
            execution={modal.execution}
            onReconcile={() => act(() => adsService.reconcileChange(modal.row))}
            onValidate={() => act(() => adsService.validateAdSet(modal.row))}
            onCheckReadiness={() => inspectRevision("readiness")}
            readinessMessage={modal.readiness}
          />
        </Modal>
      )}
    </section>
  );
}
function RevisionDetail({
  row: r,
  can,
  manage,
  busy,
  error,
  onTransition,
  onExecute,
  onCheckExecution,
  execution,
  onReconcile,
  onValidate,
  onCheckReadiness,
  readinessMessage,
}) {
  const executionAvailable = execution?.available === true && execution.request_id === r.id && execution.fingerprint === r.fingerprint && execution.operation === r.operation && Date.parse(execution.expires_at) > Date.now();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {can("marketing_ads.manage") &&
          (r.state === "reconciling" || r.configuration.recovery_source) &&
          r.operation === "create" &&
          r.provider_state?.pending === "adset" && (
            <button
              disabled={busy || !r.current}
              className="btn-secondary"
              onClick={onValidate}
            >
              Validate Ad Set without creating
            </button>
          )}
        <Badge>{r.state}</Badge>
        <Badge>Revision {r.revision}</Badge>
        <Badge>{r.brand}</Badge>
      </div>
      {r.configuration.create_contract_version===3 && can("marketing_ads.manage") && ["draft","review","approved"].includes(r.state) ? <button className="btn-secondary" disabled={busy||!r.current||!manage} onClick={onCheckReadiness}>Check Meta readiness (read only)</button>:null}
      {r.configuration.draft_only ? <p className="text-sm text-text-secondary">Incomplete draft. Choose Revise to complete the ad before review. Saving does not send anything to Meta.</p>:null}
      {r.configuration.source_post ? <section className="space-y-2"><h3 className="font-semibold">Original Facebook post</h3><p className="whitespace-pre-wrap text-sm">{r.configuration.source_post.caption||"No caption"}</p><a className="text-sm text-primary underline" target="_blank" rel="noreferrer" href={`https://www.facebook.com/${r.configuration.source_post.provider_post_id}`}>View original post</a></section>:null}
      {readinessMessage ? <p role="status" className="text-sm text-text-secondary">{readinessMessage}</p>:null}
      {error && <p role="alert">{error}</p>}
      {!r.current && ["draft", "review", "approved"].includes(r.state) && (
        <p role="status">
          Authorization, attribution or Meta configuration changed. Prepare a
          new revision before execution.
        </p>
      )}
      <dl className="ads-metrics">
        <div>
          <dt>Destination</dt>
          <dd className="!text-sm">{r.account_id}</dd>
        </div>
        <div>
          <dt>Budget envelope</dt>
          <dd>
            {r.configuration.draft_only ? "Draft — not validated" : r.operation === "pause" ? "No change" : money(r.maximum_budget)}
          </dd>
        </div>
        <div>
          <dt>Operation</dt>
          <dd className="!text-sm">
            {r.operation === "create" ? "Create paused ad" : r.operation}
          </dd>
        </div>
        <div>
          <dt>Account timezone</dt>
          <dd className="!text-sm">{r.timezone}</dd>
        </div>
      </dl>
      {r.configuration.regional_regulation_identities && (
        <section className="ads-panel text-sm space-y-2">
          <h3 className="font-semibold">Malaysia advertiser declaration</h3>
          <p>
            Advertiser (beneficiary):{" "}
            {
              r.configuration.regional_regulation_identities
                .universal_beneficiary
            }
          </p>
          <p>
            Payer:{" "}
            {r.configuration.regional_regulation_identities.universal_payer}
          </p>
          {r.configuration.promoted_object && (
            <p>Promoted Page: {r.configuration.promoted_object.page_id}</p>
          )}
          {r.configuration.recovery_source && (
            <p>
              Validation proposal for the existing paused Campaign. The original
              Reconciling record remains unchanged; creation recovery needs
              separate authorization.
            </p>
          )}
        </section>
      )}
      {r.configuration.caption && (
        <section>
          <h3 className="font-semibold">Creative</h3>
          <p className="mt-2 whitespace-pre-wrap">{r.configuration.headline}</p>
          <p className="mt-2 whitespace-pre-wrap">{r.configuration.caption}</p>
          <p className="text-sm break-all">{r.configuration.url}</p>
        </section>
      )}
      {r.configuration.media && (
        <CreativePreview asset={r.configuration.media} />
      )}
      <dl className="text-sm space-y-2">
        {[
          "resume_scope",
          "objective",
          "start_time",
          "end_time",
          "placements",
          "age_min",
          "age_max",
          "page_id",
          "instagram_id",
          "campaign_id",
        ]
          .filter((k) => r.configuration[k] != null)
          .map((k) => (
            <div key={k}>
              <dt className="text-text-secondary">{k.replaceAll("_", " ")}</dt>
              <dd>
                {k === "objective"
                  ? {
                      OUTCOME_AWARENESS: "Awareness",
                      OUTCOME_TRAFFIC: "Website Traffic",
                    }[r.configuration[k]] || r.configuration[k]
                  : ["start_time", "end_time"].includes(k)
                    ? new Date(r.configuration[k]).toLocaleString("en-MY", {
                        timeZone: r.timezone,
                      })
                    : k === "placements"
                      ? {
                          facebook_feed: "Facebook Feed",
                          instagram_feed: "Instagram Feed",
                          both_feeds: "Facebook + Instagram Feed",
                        }[r.configuration[k]]
                      : String(r.configuration[k])}
              </dd>
            </div>
          ))}
      </dl>
      <p className="text-xs text-text-secondary">
        Approval expires after 24 hours and applies only to this exact revision.
        FeedX approval is separate from authorization to send changes to Meta.
      </p>
      <div className="flex flex-wrap gap-2">
        {can("marketing_ads.execute") && r.state === "reconciling" && (
          <button
            disabled={busy}
            className="btn-secondary"
            onClick={onReconcile}
          >
            Reconcile receipts
          </button>
        )}
        {can("marketing_ads.manage") && r.state === "draft" && !r.configuration.draft_only && (
          <button
            disabled={busy || !r.current}
            className="btn-primary"
            onClick={() => onTransition("submit")}
          >
            Submit for review
          </button>
        )}
        {can("marketing_ads.review") &&
          r.state === "review" &&
          !r.reviewed_by && (
            <button
              disabled={busy || !r.current}
              className="btn-primary"
              onClick={() => onTransition("review")}
            >
              Confirm review
            </button>
          )}
        {can("marketing_ads.approve") &&
          r.state === "review" &&
          r.reviewed_by && (
            <button
              disabled={busy || !r.current}
              className="btn-primary"
              onClick={() => onTransition("approve")}
            >
              Approve exact revision
            </button>
          )}
        {can("marketing_ads.execute") && r.state === "approved" && (
          <button className="btn-secondary" disabled={busy || !r.current || !manage || !!r.configuration.recovery_source} onClick={onCheckExecution}>
            Check execution authorization
          </button>
        )}
        {can("marketing_ads.execute") && r.state === "approved" && (
          <button
            disabled={busy || !r.current || !executionAvailable || !manage || !!r.configuration.recovery_source}
            className="btn-primary"
            onClick={onExecute}
          >
            Execute approved change
          </button>
        )}
        {can("marketing_ads.manage") &&
          ["draft", "review", "approved", "failed", "stale"].includes(
            r.state,
          ) && (
            <button
              disabled={busy}
              className="btn-secondary"
              onClick={() => onTransition("cancel")}
            >
              Cancel proposal
            </button>
          )}
      </div>
      {r.state === "approved" && (!executionAvailable || !manage) && (
        <p className="text-sm text-text-secondary">
          Execution unavailable. Management permission and separate
          authorization for this exact revision are required.
        </p>
      )}
      {executionAvailable && execution.scope === "paused_create_only" && <p role="status" className="text-sm text-text-secondary">Paused creation is authorized for this exact revision. Activation and spending are not authorized; eligibility is checked again before every submission.</p>}
      {r.state === "approved" && r.configuration.recovery_source && <p className="text-sm text-text-secondary">This recovery revision supports review and validation only. Existing Meta receipts must be resolved before execution.</p>}
      {r.error_code && (
        <p className="text-sm">
          {r.state === "reconciling"
            ? "Meta outcome requires reconciliation. Do not resubmit; inspect existing receipts in Ads Manager."
            : "This change did not complete. Review authorization and current Meta settings."}
        </p>
      )}
      {r.events
        ?.filter((e) => e.event === "validate_adset")
        .slice(-1)
        .map((e) => (
          <p key={e.id} className="text-sm" role="status">
            {e.evidence.valid
              ? "Meta validation passed. Creation still requires separate authorization."
              : `Meta validation did not pass: ${e.evidence.error?.error_user_title || e.evidence.error?.error_user_msg || e.evidence.error_code || "Review diagnostic evidence."}`}
          </p>
        ))}
      <a
        className="btn-secondary"
        href={adsManagerUrl(
          r.account_id,
          r.receipt?.campaign_id || r.configuration.campaign_id,
        )}
        target="_blank"
        rel="noreferrer"
      >
        Advanced settings in Ads Manager ↗
      </a>
      <details>
        <summary>Configuration and execution evidence</summary>
        <pre className="text-xs whitespace-pre-wrap break-all max-h-80 overflow-auto">
          {JSON.stringify(
            {
              fingerprint: r.fingerprint,
              configuration: r.configuration,
              baseline: r.baseline,
              receipt: r.receipt,
              steps: r.provider_state,
              events: r.events,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}

function CreativePreview({ asset }) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    marketingService
      .assetUrl(asset)
      .then((value) => {
        if (live) setUrl(value);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [asset.id]);
  return url && !error ? (
    <img
      className="rounded-lg max-h-80 w-full object-contain"
      src={url}
      alt="Advertising creative for this revision"
      onError={() => setError(true)}
    />
  ) : (
    <p className="text-sm text-text-secondary">
      {error
        ? "Image preview unavailable. Verify the creative before approving."
        : "Loading creative…"}
    </p>
  );
}
