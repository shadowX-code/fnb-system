import { useEffect, useRef, useState } from "react";
import { MessageSquareText, Plus, RefreshCw, ShieldAlert, ArrowLeft } from "lucide-react";
import { useAuth } from "../../auth/AuthContext.jsx";
import WorkspacePage from "../../components/layout/WorkspacePage.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
import AdminFormField from "../../components/forms/AdminFormField.jsx";
import Modal from "../../components/feedback/Modal.jsx";
import AdminPagination from "../../components/tables/AdminPagination.jsx";
import Badge from "../../components/ui/Badge.jsx";
import { formatDateTime } from "../../lib/dateTime.js";
import { marketingService } from "./marketingService.js";
import { inboxService } from "./inboxService.js";
import "./marketing.css";
import "./marketingInbox.css";
const label = (s) =>
  String(s || "").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const options = (
  values,
  empty,
) => [
  ...(empty ? [{ value: "", label: empty }] : []),
  ...values.map((v) => ({ value: v, label: label(v) })),
];
const stamp = formatDateTime;
function State({ value }) {
  return (
    <Badge
      tone={["urgent", "rejected", "escalate", "permission_unavailable"]
          .includes(value)
        ? "danger"
        : ["review", "proposed", "human_takeover"].includes(value)
        ? "warning"
        : ["approved", "resolved"].includes(value)
        ? "success"
        : "neutral"}
    >
      {({permission_unavailable:"Permission required",connection_unavailable:"Unavailable",authorization_unverified:"Connected · Unverified",webhook_unverified:"Connected · Webhook unverified",receive_verified:"Operational"})[value]||label(value)}
    </Badge>
  );
}
function Field({ label: caption, ...props }) {
  return (
    <AdminFormField label={caption}>
      <input className="control" {...props} />
    </AdminFormField>
  );
}
function Area({ label: caption, ...props }) {
  return (
    <AdminFormField label={caption}>
      <textarea className="control" rows={4} {...props} />
    </AdminFormField>
  );
}
export default function MarketingInboxPage() {
  const auth = useAuth(),
    can = (p) => auth.hasPermission(`marketing_inbox.${p}`);
  const [context, setContext] = useState({ organizations: [], brands: [] }),
    [org, setOrg] = useState(""),
    [brand, setBrand] = useState("");
  const [status, setStatus] = useState(""),
    [channel, setChannel] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20),
    [historyPage, setHistoryPage] = useState(1);
  const [assignee,setAssignee]=useState(""),[unread,setUnread]=useState(false),[metrics,setMetrics]=useState(null),[analyticsStart,setAnalyticsStart]=useState(""),[analyticsEnd,setAnalyticsEnd]=useState("");
  const [selected, setSelected] = useState(""),
    [read, setRead] = useState(null),
    [detail, setDetail] = useState(null),
    [refresh, setRefresh] = useState(0),
    [configuration, setConfiguration] = useState(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState(null),
    [preview, setPreview] = useState(null);
  const scope = JSON.stringify([org, brand, auth.user?.id]),
    listKey = JSON.stringify([
      scope,
      status,
      channel,
      search,
      assignee,
      unread,
      page,
      pageSize,
      refresh,
    ]),
    detailKey = JSON.stringify([scope, selected, historyPage, refresh]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const activeDetail = useRef(detailKey);
  activeDetail.current = detailKey;
  const request = useRef(null), generation = useRef(0);
  const brands = context.brands.filter((b) => b.organization_id === org),
    data = read?.key === listKey ? read.data : null,
    current = detail?.key === activeDetail.current ? detail.data : null,
    c = current?.conversation;
  useEffect(() => {
    let live = true;
    setContext({ organizations: [], brands: [] });
    setRead(null);
    setDetail(null);
    setConfiguration(null);
    marketingService.context().then((v) => {
      if (live) {
        setContext(v);
        setOrg(v.organizations[0]?.id || "");
      }
    }).catch((e) => {
      if (live) setError(e.message);
    });
    inboxService.configuration().then((v) => {
      if (live) setConfiguration(v);
    }).catch(() => {});
    return () => {
      live = false;
      generation.current++;
    };
  }, [auth.user?.id]);
  useEffect(() => {
    setPage(1);
    setSelected("");
    setModal(null);
    setNotice("");
    setPreview(null);
    setBusy(false);
    request.current = null;
    generation.current++;
  }, [scope]);
  useEffect(() => {
    let live = true;
    setError("");
    setLoading(Boolean(org));
    if (!org) {
      setLoading(false);
      return () => {
        live = false;
      };
    }
    inboxService.read({ org, brand, status, channel, search, assignee, unread, page, pageSize })
      .then((v) => {
        if (live) setRead({ key: listKey, data: v });
      }).catch((e) => {
        if (live) setError(e.message);
      }).finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [listKey]);
  useEffect(() => {
    let live = true;
    setDetail(null);
    setPreview(null);
    if (selected) {
      inboxService.detail(selected, historyPage).then((v) => {
        if (live) {
          setDetail({ key: detailKey, data: v });
          if (historyPage===1 && v.read_through_sequence!==undefined) inboxService.markRead(selected,v.read_through_sequence).then(()=>{if(live)setRead(previous=>previous?{...previous,data:{...previous.data,rows:previous.data.rows.map(row=>row.id===selected?{...row,unread_count:0}:row)}}:previous);}).catch((e)=>{if(live)setError(e.message);});
        }
      }).catch((e) => {
        if (live) setError(e.message);
      });
    }
    return () => {
      live = false;
    };
  }, [detailKey]);
  useEffect(()=>{
    let live=true;setMetrics(null);
    if(org) inboxService.analytics({org,brand,channel,start:analyticsStart?`${analyticsStart}T00:00:00+08:00`:null,end:analyticsEnd?`${analyticsEnd}T00:00:00+08:00`:null}).then(v=>{if(live)setMetrics(v);}).catch(()=>{});
    return ()=>{live=false;};
  },[scope,channel,analyticsStart,analyticsEnd,refresh]);
  useEffect(() => {
    if (data && page > Math.max(1, Math.ceil(data.total / pageSize))) {
      setPage(Math.max(1, Math.ceil(data.total / pageSize)));
    }
  }, [data?.total, page, pageSize]);
  async function mutate(
    intent,
    action,
    message = "Saved. No external message was sent.",
  ) {
    const s = activeScope.current,
      g = generation.current,
      fp = JSON.stringify(intent);
    if (request.current?.fp !== fp) {
      request.current = { fp, id: crypto.randomUUID() };
    }
    const id = request.current.id;
    setBusy(true);
    setError("");
    try {
      const result = await action(id);
      if (s !== activeScope.current || g !== generation.current) return;
      request.current = null;
      setModal(null);
      setNotice(message);
      setRefresh((r) => r + 1);
      if (intent.command === "create") setSelected(result.conversation.id);
    } catch (e) {
      if (s === activeScope.current && g === generation.current) {
        setError(e.message);
      }
    } finally {
      if (s === activeScope.current && g === generation.current) setBusy(false);
    }
  }
  function command(name, payload = {}) {
    return mutate(
      {
        command: name,
        scope,
        conversation: c?.id,
        version: c?.version,
        payload,
      },
      (id) =>
        inboxService.command(id, org, c?.brand_id || brand, c, name, payload),
    );
  }
  function configure(name, revision, payload = {}) {
    return mutate(
      { command: name, scope, revision, payload },
      (id) => inboxService.configure(id, brand, revision, name, payload),
    );
  }
  async function faqPreview(text) {
    const s = scope, key = detailKey;
    setBusy(true);
    setError("");
    try {
      const v = await inboxService.preview(c.id, text);
      if (activeScope.current === s && key === activeDetail.current) {
        setPreview(v);
      }
    } catch (e) {
      if (activeScope.current === s && key === activeDetail.current) {
        setError(e.message);
      }
    } finally {
      if (activeScope.current === s) setBusy(false);
    }
  }
  function openCase() {
    setModal({ type: "create", title: "" });
  }
  const controls = (
    <div className="marketing-inbox-controls">
      <SelectField
        label="Organization"
        value={org}
        onChange={(v) => {
          setOrg(v);
          setBrand("");
        }}
        options={context.organizations.map((o) => ({
          value: o.id,
          label: o.name,
        }))}
      />
      <SelectField
        label="Brand"
        value={brand}
        onChange={setBrand}
        options={[
          { value: "", label: "All authorized brands" },
          ...brands.map((b) => ({ value: b.id, label: b.name })),
        ]}
      />
      <SelectField
        label="Status"
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage(1);
          setSelected("");
        }}
        options={options(["open", "pending", "resolved"], "All statuses")}
      />
      <SelectField
        label="Channel"
        value={channel}
        onChange={(v) => {
          setChannel(v);
          setPage(1);
          setSelected("");
        }}
        options={options(["internal", "facebook", "instagram"], "All channels")}
      />
      <SelectField label="Assignee" value={assignee} onChange={v=>{setAssignee(v);setPage(1);setSelected("");}} options={[{value:"",label:"All assignees"},{value:"me",label:"Assigned to me"},{value:"unassigned",label:"Unassigned"},...(data?.members||[]).map(m=>({value:m.id,label:m.name}))]} />
      <label className="marketing-inbox-check"><input type="checkbox" checked={unread} onChange={e=>{setUnread(e.target.checked);setPage(1);}}/>Unread only</label>
      <Field
        label="Search conversations"
        value={search}
        maxLength={100}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
          setSelected("");
        }}
      />
    </div>
  );
  return (
    <WorkspacePage
      section="Marketing"
      title="Unified Inbox"
      description="Conversations, approved replies and human handling."
      controls={controls}
      actions={
        <>
          <button
            className="btn-secondary"
            onClick={() => setRefresh((r) => r + 1)}
            disabled={busy}
          >
            <RefreshCw size={16} />Refresh
          </button>
          {can("manage") && (
            <button
              className="btn-primary"
              onClick={openCase}
              disabled={!brand || busy}
            >
              <Plus size={16} />Internal case
            </button>
          )}
          {brand && (
            <button
              className="btn-secondary"
              disabled={busy || !data}
              onClick={() =>
                setModal({
                  type: "settings",
                  policy: data?.policy ||
                    { revision: 0, automation_mode: "suggest", ai_allowed: false },
                })}
            >
              FAQ & AI settings
            </button>
          )}
        </>
      }
    >
      <div className="marketing-inbox-notice">
        <ShieldAlert size={18} />
        <p>
          Live messaging and automatic sending are disabled. Internal notes,
          drafts and approvals never send to Facebook or Instagram.
        </p>
      </div>
      {error && <p role="alert" className="text-danger">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <details className="marketing-inbox-analytics"><summary>Inbox performance</summary>
        <div className="marketing-inbox-actions"><Field label="Conversations from" type="date" value={analyticsStart} onChange={e=>setAnalyticsStart(e.target.value)}/><Field label="Conversations before" type="date" value={analyticsEnd} onChange={e=>setAnalyticsEnd(e.target.value)}/></div>
        <p>Conversations {metrics?.volume??"Unavailable"} · Unresolved {metrics?.unresolved??"Unavailable"} · Human handovers {metrics?.human_handovers??"Unavailable"}</p>
        <p>Median first response {metrics?.first_response_seconds==null?"Unavailable":`${Math.round(metrics.first_response_seconds)}s`} · AI acceptance {metrics?.ai_acceptance_rate==null?"Unavailable":`${Math.round(metrics.ai_acceptance_rate*100)}%`} · Automation {metrics?.automation_rate==null?"Unavailable":`${Math.round(metrics.automation_rate*100)}%`}</p>
        <small>Conversations created in the selected period · Asia/Kuala_Lumpur. Reply drafts are not sent responses.</small>
      </details>
      <p className="text-sm text-text-secondary">
        AI usage in this scope: {data?.ai_usage?.requests ?? 0} requests ·{" "}
        {data?.ai_usage?.input_tokens ?? "Unavailable"} input /{" "}
        {data?.ai_usage?.output_tokens ?? "Unavailable"}{" "}
        output tokens · Costs unavailable.
      </p>
      <div className="marketing-inbox-capabilities">
        {data?.channels.map((v) => (
          <div className="card p-3" key={v.connection_id}>
            <strong>{v.account_name}</strong> · {label(v.channel)}{" "}
            <State value={v.state} />
            <p className="text-sm text-text-secondary">
              Receive: {v.receiving_verified ? "Verified" : "Unverified"}{" "}
              · Send: Disabled · Comments: {label(v.comments?.state||"unverified")}{Object.entries(v.events || {}).filter((
                [state, count],
              ) =>
                state !== "processed" && count > 0
              ).map(([state, count]) =>
                ` · ${count} ${label(state)} webhook events`
              ).join("")}
            </p>
          </div>
        ))}
      </div>
      <AdminPagination
        page={page}
        pageSize={pageSize}
        total={data?.total || 0}
        loading={loading}
        noun="conversations"
        onPageChange={setPage}
        onPageSizeChange={(v) => {
          setPageSize(v);
          setPage(1);
        }}
      />
      <div className={`marketing-inbox-grid ${selected?"has-selection":""}`}>
        <section
          className="card marketing-inbox-list"
          aria-label="Conversations"
        >
          <h2>
            Conversations{" "}
            <span className="text-text-muted">{data?.total ?? 0}</span>
          </h2>
          {loading && <p role="status">Loading conversations…</p>}
          {data?.rows.length === 0 && (
            <p>
              No conversations match this scope. Select a brand to open an
              internal case.
            </p>
          )}
          {data?.rows.map((row) => (
            <button
              className={`marketing-inbox-row ${
                selected === row.id ? "selected" : ""
              }`}
              key={row.id}
              onClick={() => {
                setSelected(row.id);
                setHistoryPage(1);
                setModal(null);
                setPreview(null);
              }}
            >
              <strong>{row.title} {row.unread_count>0&&<Badge tone="warning">{row.unread_count} unread</Badge>}</strong>
              <span>{row.brand_name} · {label(row.channel)}{row.medium==="comment"?" · Comment":""} · {label(row.intent||"unknown")}</span>
              <span>
                <State value={row.status} /> <State value={row.priority} />
              </span>
              <small>
                {stamp(row.updated_at)}
                {row.escalation_reasons.length ? " · Human escalation" : ""}
              </small>
            </button>
          ))}
        </section>
        <section
          className="card marketing-inbox-thread"
          aria-label="Conversation history"
        >
          {!c
            ? (
              <div className="marketing-inbox-empty">
                <MessageSquareText size={32} />
                <p>
                  {selected
                    ? "Loading conversation…"
                    : "Select a conversation to review its history."}
                </p>
              </div>
            )
            : (
              <>
                <div className="marketing-inbox-heading">
                  <div>
                    <button className="btn-secondary marketing-inbox-back" onClick={()=>setSelected("")}><ArrowLeft size={16}/>Conversations</button>
                    <h2>{c.title}</h2>
                    <p>
                      {label(c.channel)} · <State value={c.status} />
                      {c.channel === "internal"
                        ? " · Internal case"
                        : " · Social identity kept separate from customer records"}
                    </p>
                  </div>
                </div>
                {!!c.escalation_reasons.length && (
                  <p role="status" className="marketing-inbox-escalation">
                    Human handling required:{" "}
                    {c.escalation_reasons.map(label).join(", ")}.
                  </p>
                )}
                {c.summary && (
                  <div className="marketing-inbox-summary">
                    <strong>
                      Approved summary{" "}
                      {c.summary_version !== c.version
                        ? "(history changed)"
                        : ""}
                    </strong>
                    <p>{c.summary}</p>
                  </div>
                )}
                <div className="marketing-inbox-history">
                  {current.messages.length === 0 && (
                    <p>
                      No message history. Internal notes are clearly marked.
                    </p>
                  )}
                  {current.messages.map((m) => (
                    <article
                      key={m.id}
                      className={`marketing-inbox-message ${m.kind}`}
                    >
                      <header>
                        <strong>
                          {m.kind === "note" ? "Internal note" : label(m.kind)}
                        </strong>{" "}
                        · {m.actor_name || "Channel event"}{" "}
                        <time>{stamp(m.occurred_at)}</time>
                      </header>
                      <p>{m.body || `${label(m.delivery_state)} receipt`}</p>
                    </article>
                  ))}
                </div>
                {current.total > 30 && (
                  <div className="marketing-inbox-actions">
                    <button
                      className="btn-secondary"
                      disabled={historyPage * 30 >= current.total}
                      onClick={() => setHistoryPage((p) => p + 1)}
                    >
                      Older messages
                    </button>
                    <span>History page {historyPage}</span>
                    <button
                      className="btn-secondary"
                      disabled={historyPage === 1}
                      onClick={() => setHistoryPage((p) => p - 1)}
                    >
                      Newer messages
                    </button>
                  </div>
                )}
                <div className="marketing-inbox-actions">
                  {can("manage") && (
                    <button
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => setModal({ type: "note", body: "" })}
                    >
                      Add internal note
                    </button>
                  )}
                  {can("reply") && (
                    <>
                      <button
                        className="btn-primary"
                        disabled={busy}
                        onClick={() => setModal({ type: "draft", body: "" })}
                      >
                        Prepare reply
                      </button>
                      <button
                        className="btn-secondary"
                        disabled={busy}
                        onClick={() =>
                          setModal({ type: "preview", question: "" })}
                      >
                        Preview approved FAQ
                      </button>
                    </>
                  )}
                </div>
                {preview && (
                  <div className="marketing-inbox-summary">
                    <State value={preview.state} />
                    <p>
                      {preview.faq?.answer ||
                        "A person must handle this question."}
                    </p>
                    {preview.faq && can("reply") && (
                      <button
                        className="btn-secondary"
                        disabled={busy}
                        onClick={() =>
                          command("faq_draft", { faq_id: preview.faq.id })}
                      >
                        Use as a reply draft
                      </button>
                    )}
                    <small>Preview only. No message is sent.</small>
                  </div>
                )}
                <h3>Reply drafts · {current.drafts.length} recent</h3>
                {current.drafts.map((d) => (
                  <article className="marketing-inbox-draft" key={d.id}>
                    <State value={d.status} />{" "}
                    <span>
                      {label(d.provenance)}
                      {d.source_version !== c.version
                        ? " · History changed"
                        : ""}
                    </span>
                    <p>{d.body}</p>
                    {d.source_references?.length > 0 && (
                      <small>
                        Approved facts: {d.source_references.join(", ")}
                      </small>
                    )}
                    <div className="marketing-inbox-actions">
                      {d.source_version === c.version && d.status === "draft" &&
                        can("reply") && (
                        <button
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() =>
                            command("review_reply", { draft_id: d.id })}
                        >
                          Submit for review
                        </button>
                      )}
                      {d.source_version === c.version &&
                        d.status === "review" && can("approve") && (
                        <>
                          <button
                            className="btn-primary"
                            disabled={busy}
                            onClick={() =>
                              command("approve_reply", { draft_id: d.id })}
                          >
                            Approve draft
                          </button>
                          <button
                            className="btn-secondary"
                            disabled={busy}
                            onClick={() =>
                              command("reject_reply", { draft_id: d.id })}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {["draft", "review"].includes(d.status) &&
                        d.source_version === c.version && can("reply") && (
                        <button
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() =>
                            command("cancel_reply", { draft_id: d.id })}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    {d.status === "approved" && (
                      <p className="text-sm text-text-secondary">
                        {d.source_version === c.version
                          ? "Approval recorded for this history version."
                          : "Historical approval; conversation history changed."}
                        {" "}
                        Delivery blocked: live messaging is disabled.
                      </p>
                    )}
                  </article>
                ))}
                <h3>AI proposals · {current.artifacts.length} recent</h3>
                <p className="text-sm text-text-secondary">
                  Suggestions use approved facts. Human approval is required.
                  Provider:{" "}
                  {configuration?.ai_configured ? "Configured" : "Unavailable"}.
                  Usage costs are unavailable until a pricing source is
                  configured.
                </p>
                <div className="marketing-inbox-actions">
                  {can("ai") &&
                    ["reply", "summary", "faq"].map((kind) => (
                      <button
                        key={kind}
                        className="btn-secondary"
                        disabled={busy || !configuration?.ai_configured}
                        onClick={() =>
                          mutate(
                            { scope, id: c.id, version: c.version, kind },
                            (id) => inboxService.suggest(id, c, kind),
                            "AI request recorded. Review any verified proposal below.",
                          )}
                      >
                        Suggest {kind === "faq" ? "FAQ improvement" : kind}
                      </button>
                    ))}
                </div>
                {current.artifacts.map((a) => (
                  <article className="marketing-inbox-draft" key={a.id}>
                    <strong>{label(a.kind)}</strong> <State value={a.state} />
                    <p>{a.body.question}</p>
                    <p>{a.body.text}</p>
                    <small>
                      Facts: {a.body.reference_keys.join(", ") || "None"} ·{" "}
                      {a.model} · Input {a.input_tokens ?? "Unavailable"}{" "}
                      / output {a.output_tokens ?? "Unavailable"}{" "}
                      tokens{a.source_version !== c.version
                        ? " · History changed"
                        : ""}
                    </small>
                    {a.body.human_required && <p>Human handling required.</p>}
                    {a.state === "proposed" && a.source_version === c.version &&
                      can("approve") && (
                      <div className="marketing-inbox-actions">
                        <button
                          className="btn-primary"
                          disabled={busy}
                          onClick={() =>
                            mutate(
                              { scope, artifact: a.id, approve: true },
                              () =>
                                inboxService.reviewAI(a.id, true),
                              "Proposal approved. Replies and FAQs still require their own review.",
                            )}
                        >
                          Approve proposal
                        </button>
                        <button
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() =>
                            mutate(
                              { scope, artifact: a.id, approve: false },
                              () => inboxService.reviewAI(a.id, false),
                            )}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </>
            )}
        </section>
        <aside
          className="card marketing-inbox-operations"
          aria-label="Conversation operations"
        >
          {c
            ? (
              <>
                <h2>Handling</h2><p>{label(c.medium||"dm")} · {label(c.intent||"unknown")} · {c.language||"EN"} · {c.classification_source==="ai"?"AI classification":"Rule classification"}</p>{c.opted_out&&<p role="status">Customer opted out. Automation paused.</p>}
                <State value={c.takeover ? "human_takeover" : "faq_preview"} />
                <p className="text-sm text-text-secondary">
                  {c.channel === "internal"
                    ? "This case has no external recipient."
                    : current.window_open
                    ? `Standard reply window ends ${
                      stamp(current.window_expires_at)
                    }.`
                    : "Standard reply window is closed or unverified."}{" "}
                  Sending stays disabled.
                </p>
                {can("manage") && (
                  <>
                    <button
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() =>
                        setModal({
                          type: "handling",
                          status: c.status,
                          priority: c.priority,
                          assigned_to: c.assigned_to || "",
                          tags: c.tags.join(", "),
                          takeover: c.takeover,
                        })}
                    >
                      Edit handling
                    </button>
                    <SelectField
                      label="Escalate to a person"
                      value=""
                      onChange={(reason) => command("escalate", { reason })}
                      disabled={busy}
                      options={options([
                        "complaint",
                        "refund",
                        "allergen",
                        "food_safety",
                        "uncertain",
                      ])}
                      placeholder="Choose reason"
                    />
                    {!!c.escalation_reasons.length && (
                      <button
                        className="btn-secondary"
                        disabled={busy}
                        onClick={() =>
                          setModal({ type: "resolve", reason: "" })}
                      >
                        Record escalation resolution
                      </button>
                    )}
                  </>
                )}
                <dl>
                  <dt>Assigned to</dt>
                  <dd>
                    {current.members.find((m) => m.id === c.assigned_to)
                      ?.name || "Unassigned"}
                  </dd>
                  <dt>Priority</dt>
                  <dd>{label(c.priority)}</dd>
                  <dt>Tags</dt>
                  <dd>{c.tags.join(", ") || "None"}</dd>
                  <dt>History version</dt>
                  <dd>{c.version}</dd>
                </dl>
              </>
            )
            : (
              <p>
                Assignment and escalation appear after selecting a conversation.
              </p>
            )}
        </aside>
      </div>
      {modal && (
        <Modal
          title={label(
            modal.type === "settings" ? "FAQ & AI Settings" : modal.type,
          )}
          onClose={() => {
            if (!busy) setModal(null);
          }}
        >
          <InboxModal
            modal={modal}
            setModal={setModal}
            busy={busy}
            data={data}
            can={can}
            members={current?.members || []}
            command={command}
            configure={configure}
            preview={faqPreview}
          />
        </Modal>
      )}
    </WorkspacePage>
  );
}
function InboxModal(
  { modal: m, setModal, busy, data, can, members, command, configure, preview },
) {
  const set = (k, v) => setModal((x) => ({ ...x, [k]: v }));
  if (m.type === "settings") {
    return (
      <div className="marketing-inbox-form">
        <p>
          All sending remains disabled. FAQ mode controls internal matching and
          proposed replies only.
        </p>
        <h3>Approved Brand Knowledge</h3>
        <p>
          {data?.knowledge?.approved_for_replies
            ? "Current knowledge approved for replies."
            : "Current knowledge needs approval before FAQ or AI use."}
        </p>
        <p>
          Manage verified brand facts in Marketing Settings. External research
          and AI suggestions are excluded from reply knowledge.
        </p>
        <div className="marketing-inbox-facts">
          {Object.entries(data?.knowledge?.profile || {}).filter(([, v]) =>
            v.provenance === "verified_brand_fact"
          ).map(([k, v]) => (
            <p key={k}>
              <strong>{label(k)}:</strong> {v.text}
            </p>
          ))}
        </div>
        {can("approve") && data?.knowledge &&
          !data.knowledge.approved_for_replies && (
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() =>
              configure("approve_knowledge", data.knowledge.revision)}
          >
            Approve this knowledge revision
          </button>
        )}
        {can("configure") && (
          <>
            <SelectField
              label="FAQ plan"
              value={m.policy.automation_mode||"suggest"}
              onChange={(v) =>
                set("policy", { ...m.policy, automation_mode: v })}
              options={options(["off", "suggest", "faq"])}
            />
            <label className="marketing-inbox-check">
              <input
                type="checkbox"
                checked={m.policy.ai_allowed}
                onChange={(e) =>
                  set("policy", { ...m.policy, ai_allowed: e.target.checked })}
              />Allow AI suggestions using approved facts and conversation
              history with direct contact details removed
            </label>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() =>
                configure("policy", m.policy.revision, {
                  automation_mode: m.policy.automation_mode,
                  ai_allowed: m.policy.ai_allowed,
                })}
            >
              Save brand settings
            </button>
          </>
        )}
        <h3>FAQ library · {data?.faqs.length || 0}/100</h3>
        {can("configure") && (
          <button
            className="btn-secondary"
            disabled={busy || !data?.knowledge?.approved_for_replies}
            onClick={() =>
              setModal({
                type: "faq",
                question: "",
                answer: "",
                language: "EN",
                reference_keys: [],
                revision: 0,
              })}
          >
            New FAQ
          </button>
        )}
        {data?.faqs.map((f) => (
          <article className="marketing-inbox-draft" key={f.id}>
            <strong>{f.question}</strong> <State value={f.status} />
            <p>{f.answer}</p>
            <small>
              {f.language} · Facts: {f.reference_keys.join(", ")}{" "}
              · Knowledge revision {f.knowledge_revision}
            </small>
            <div className="marketing-inbox-actions">
              {can("configure") && (
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => setModal({ type: "faq", ...f })}
                >
                  Revise
                </button>
              )}
              {f.status === "draft" && can("approve") && (
                <>
                  <button
                    className="btn-primary"
                    disabled={busy}
                    onClick={() =>
                      configure("approve_faq", f.revision, { id: f.id })}
                  >
                    Approve exact FAQ
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() =>
                      configure("reject_faq", f.revision, { id: f.id })}
                  >
                    Reject
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
    );
  }
  if (m.type === "faq") {
    return (
      <form
        className="marketing-inbox-form"
        onSubmit={(e) => {
          e.preventDefault();
          configure("save_faq", m.revision, {
            id: m.id,
            question: m.question,
            answer: m.answer,
            language: m.language,
            reference_keys: m.reference_keys,
          });
        }}
      >
        <Field
          label="FAQ question"
          value={m.question}
          onChange={(e) => set("question", e.target.value)}
          maxLength={500}
          required
        />
        <Area
          label="Answer for review"
          value={m.answer}
          onChange={(e) => set("answer", e.target.value)}
          maxLength={4000}
          required
        />
        <SelectField
          label="Language"
          value={m.language}
          onChange={(v) => set("language", v)}
          options={options(["EN", "ZH", "BM"])}
        />
        <fieldset>
          <legend>Supporting approved facts (required)</legend>
          {Object.entries(data?.knowledge?.profile || {}).filter(([, v]) =>
            v.provenance === "verified_brand_fact"
          ).map(([k]) => (
            <label key={k} className="marketing-inbox-check">
              <input
                type="checkbox"
                checked={m.reference_keys.includes(k)}
                onChange={(e) =>
                  set(
                    "reference_keys",
                    e.target.checked
                      ? [...m.reference_keys, k]
                      : m.reference_keys.filter((x) => x !== k),
                  )}
              />
              {label(k)}
            </label>
          ))}
        </fieldset>
        <button
          className="btn-primary"
          disabled={busy || !m.reference_keys.length}
        >
          Save FAQ draft
        </button>
      </form>
    );
  }
  return (
    <form
      className="marketing-inbox-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (m.type === "handling") {
          command("update", {
            status: m.status,
            priority: m.priority,
            assigned_to: m.assigned_to,
            tags: m.tags.split(",").map((t) => t.trim()).filter(Boolean),
            takeover: m.takeover,
          });
        } else if (m.type === "preview") {
          preview(m.question);
          setModal(null);
        } else if (m.type === "resolve") {
          command("clear_escalation", {
            reason: m.reason,
          });
        } else {command(
            m.type,
            m.type === "create" ? { title: m.title } : { body: m.body },
          );}
      }}
    >
      {m.type === "create" && (
        <>
          <p>
            Internal case only. This does not create a customer message or
            external recipient.
          </p>
          <Field
            label="Case title"
            value={m.title}
            onChange={(e) => set("title", e.target.value)}
            maxLength={160}
            required
          />
        </>
      )}
      {["note", "draft"].includes(m.type) && (
        <Area
          label={m.type === "note" ? "Internal note" : "Reply draft (not sent)"}
          value={m.body}
          onChange={(e) => set("body", e.target.value)}
          maxLength={8000}
          required
        />
      )}
      {m.type === "preview" && (
        <Field
          label="Question to match"
          value={m.question}
          onChange={(e) => set("question", e.target.value)}
          maxLength={500}
          required
        />
      )}
      {m.type === "resolve" && (
        <Area
          label="Human resolution evidence"
          value={m.reason}
          onChange={(e) => set("reason", e.target.value)}
          maxLength={1000}
          required
        />
      )}
      {m.type === "handling" && (
        <>
          <SelectField
            label="Status"
            value={m.status}
            onChange={(v) => set("status", v)}
            options={options(["open", "pending", "resolved"])}
          />
          <SelectField
            label="Priority"
            value={m.priority}
            onChange={(v) => set("priority", v)}
            options={options(["low", "normal", "high", "urgent"])}
          />
          <SelectField
            label="Assigned team member"
            value={m.assigned_to}
            onChange={(v) => set("assigned_to", v)}
            options={[
              { value: "", label: "Unassigned" },
              ...members.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <Field
            label="Tags (comma separated, up to ten)"
            value={m.tags}
            onChange={(e) => set("tags", e.target.value)}
            maxLength={410}
          />
          <label className="marketing-inbox-check">
            <input
              type="checkbox"
              checked={m.takeover}
              onChange={(e) => set("takeover", e.target.checked)}
            />Human takeover (sensitive cases always retain this)
          </label>
        </>
      )}
      <button className="btn-primary" disabled={busy}>
        {busy ? "Saving…" : m.type === "preview" ? "Preview FAQ" : "Save"}
      </button>
    </form>
  );
}
