import { useEffect, useRef, useState } from "react";
import {
  MessageSquareText,
  Plus,
  RefreshCw,
  ArrowLeft,
  PanelRight,
  X,
  UserRound,
  Instagram,
  Facebook,
  Check,
  CheckCheck,
  MoreHorizontal,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext.jsx";
import WorkspacePage from "../../components/layout/WorkspacePage.jsx";
import AdminFilterToolbar from "../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../components/forms/AdminSearchField.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
import AdminFormField from "../../components/forms/AdminFormField.jsx";
import ActionMenu from "../../components/ui/ActionMenu.jsx";
import Modal from "../../components/feedback/Modal.jsx";
import AdminPagination from "../../components/tables/AdminPagination.jsx";
import Badge from "../../components/ui/Badge.jsx";
import { formatDateTime } from "../../lib/dateTime.js";
import { marketingService } from "./marketingService.js";
import { inboxService } from "./inboxService.js";
import "./marketing.css";
import "./marketingInbox.css";
import { notifyConversationsChanged } from "./useConversationReplyCount.js";
import InboxReplyComposer from "./InboxReplyComposer.jsx";
import { socialIdentity, conversationTimeline } from "./inboxPresentation.js";
const label = (s) =>
  String(s || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
const options = (values, empty) => [
  ...(empty ? [{ value: "", label: empty }] : []),
  ...values.map((v) => ({ value: v, label: label(v) })),
];
const stamp = formatDateTime;
const clock = (value) =>
  value
    ? new Intl.DateTimeFormat("en-MY", {
        timeZone: "Asia/Kuala_Lumpur",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(value))
    : "";
const day = (value) =>
  new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
function CustomerAvatar({ conversation }) {
  const identity = socialIdentity(conversation),
    [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [identity.avatar]);
  return (
    <span className="inbox-avatar">
      {identity.avatar && !failed ? (
        <img
          src={identity.avatar}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <UserRound size={20} />
      )}
      <span
        className={`inbox-channel ${conversation.channel}`}
        aria-label={label(conversation.channel)}
      >
        {conversation.channel === "instagram" ? (
          <Instagram size={10} />
        ) : conversation.channel === "facebook" ? (
          <Facebook size={10} />
        ) : (
          <MessageSquareText size={10} />
        )}
      </span>
    </span>
  );
}
function State({ value }) {
  return (
    <Badge
      tone={
        ["urgent", "rejected", "escalate", "permission_unavailable"].includes(
          value,
        )
          ? "danger"
          : ["review", "proposed", "human_takeover"].includes(value)
            ? "warning"
            : ["approved", "resolved"].includes(value)
              ? "success"
              : "neutral"
      }
    >
      {{
        permission_unavailable: "Permission required",
        connection_unavailable: "Unavailable",
        authorization_unverified: "Connected · Unverified",
        webhook_unverified: "Connected · Webhook unverified",
        receive_verified: "Operational",
      }[value] || label(value)}
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
    [channel, setChannel] = useState("social"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20),
    [historyPage, setHistoryPage] = useState(1);
  const [assignee, setAssignee] = useState(""),
    [unread, setUnread] = useState(false),
    [metrics, setMetrics] = useState(null),
    [analyticsStart, setAnalyticsStart] = useState(""),
    [analyticsEnd, setAnalyticsEnd] = useState("");
  const [selected, setSelected] = useState(""),
    [read, setRead] = useState(null),
    [detail, setDetail] = useState(null),
    [refresh, setRefresh] = useState(0),
    [configuration, setConfiguration] = useState(null);
  const [verification, setVerification] = useState(null),
    [detailsOpen, setDetailsOpen] = useState(false),
    [actionsOpen, setActionsOpen] = useState(false),
    [sendStatus, setSendStatus] = useState(null),
    [profiles, setProfiles] = useState({ scope: null, rows: {} });
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState(null),
    [preview, setPreview] = useState(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const scope = JSON.stringify([org, brand, auth.user?.id]),
    listBaseKey=JSON.stringify([scope,status,channel,search,assignee,unread,page,pageSize]),
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
    detailBaseKey = JSON.stringify([scope, selected, historyPage]),
    detailKey = JSON.stringify([scope, selected, historyPage, refresh]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const activeDetail = useRef(detailKey);
  activeDetail.current = detailKey;
  const request = useRef(null),
    generation = useRef(0),
    historyRef = useRef(null);
  const brands = context.brands.filter((b) => b.organization_id === org),
    data = read?.baseKey === listBaseKey ? read.data : null,
    current = detail?.baseKey === detailBaseKey ? detail.data : null,
    c = current?.conversation;
  useEffect(() => {
    let live = true;
    setContext({ organizations: [], brands: [] });
    setRead(null);
    setDetail(null);
    setConfiguration(null);
    marketingService
      .context()
      .then((v) => {
        if (live) {
          setContext(v);
          setOrg(v.organizations[0]?.id || "");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    inboxService
      .configuration()
      .then((v) => {
        if (live) setConfiguration(v);
      })
      .catch(() => {});
    return () => {
      live = false;
      generation.current++;
    };
  }, [auth.user?.id]);
  useEffect(() => {
    setPage(1);
    setSelected("");
    setDetailsOpen(false);
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
    inboxService
      .read({
        org,
        brand,
        status,
        channel,
        search,
        assignee,
        unread,
        page,
        pageSize,
      })
      .then((v) => {
        if (live) setRead({ key: listKey, baseKey:listBaseKey, data: v });
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [listKey]);
  useEffect(() => {
    let live = true;
    setDetail((previous) =>
      previous?.baseKey === detailBaseKey ? previous : null,
    );
    setPreview(null);
    if (selected) {
      inboxService
        .detail(selected, historyPage)
        .then((v) => {
          if (live) {
            setDetail({ key: detailKey, baseKey: detailBaseKey, data: v });
            if (historyPage === 1 && v.read_through_sequence !== undefined)
              inboxService
                .markRead(selected, v.read_through_sequence)
                .then(() => {
                  if (live)
                    setRead((previous) =>
                      previous
                        ? {
                            ...previous,
                            data: {
                              ...previous.data,
                              rows: previous.data.rows.map((row) =>
                                row.id === selected
                                  ? { ...row, unread_count: 0 }
                                  : row,
                              ),
                            },
                          }
                        : previous,
                    );
                })
                .catch((e) => {
                  if (live) setError(e.message);
                });
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    }
    return () => {
      live = false;
    };
  }, [detailKey]);
  useEffect(() => {
    let live = true;
    setMetrics(null);
    if (org)
      inboxService
        .analytics({
          org,
          brand,
          channel,
          start: analyticsStart ? `${analyticsStart}T00:00:00+08:00` : null,
          end: analyticsEnd ? `${analyticsEnd}T00:00:00+08:00` : null,
        })
        .then((v) => {
          if (live) setMetrics(v);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [scope, channel, analyticsStart, analyticsEnd, refresh]);
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
      setNotice(typeof message === "function" ? message(result) : message);
      setRefresh((r) => r + 1);
      notifyConversationsChanged();
      if (intent.command === "create") {
        setChannel("internal");
        setSelected(result.conversation.id);
      }
      return result;
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
    return mutate({ command: name, scope, revision, payload }, (id) =>
      inboxService.configure(id, brand, revision, name, payload),
    );
  }
  async function faqPreview(text) {
    const s = scope,
      key = detailKey;
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
  const profileIds = JSON.stringify(
    (data?.rows || [])
      .filter((row) => row.channel !== "internal")
      .map((row) => row.id),
  );
  useEffect(() => {
    let live = true;
    setProfiles({ scope, rows: {} });
    const ids = JSON.parse(profileIds);
    if (ids.length)
      inboxService
        .profiles(ids)
        .then((result) => {
          if (live && activeScope.current === scope)
            setProfiles({ scope, rows: result.profiles || {} });
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [scope, profileIds]);
  const withProfile = (row) => ({
    ...row,
    customer_profile: profiles.scope === scope ? profiles.rows[row.id] : null,
  });
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden" && !busyRef.current)
        setRefresh((r) => r + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let live = true;
    setSendStatus(null);
    if (selected)
      inboxService
        .sendStatus(selected)
        .then((v) => {
          if (live) setSendStatus({ key: detailKey, data: v });
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [detailKey]);
  const controls = <div className="marketing-inbox-controls">
    <div className="admin-scope-controls" aria-label="Marketing scope">      {context.organizations.length > 1 && (
        <SelectField searchable="auto"
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
      )}
      <SelectField searchable="auto"
        label="Brand"
        value={brand}
        onChange={setBrand}
        options={[
          { value: "", label: "All authorized brands" },
          ...brands.map((b) => ({ value: b.id, label: b.name })),
        ]}
      />
</div>
    <AdminFilterToolbar compact denseFields ariaLabel="Conversation filters"
      search={<AdminSearchField label="Search" ariaLabel="Search conversations" value={search} maxLength={100} onChange={value=>{setSearch(value);setPage(1);setSelected('')}}/>}
      moreFilters={<>          <SelectField
            label="Channel"
            value={channel}
            onChange={(v) => {
              setChannel(v);
              setPage(1);
              setSelected("");
            }}
            options={[
              { value: "social", label: "All" },
              { value: "facebook", label: "Facebook" },
              { value: "instagram", label: "Instagram" },
              { value: "internal", label: "Internal cases" },
            ]}
          />
          <SelectField
            label="Assignee"
            value={assignee}
            onChange={(v) => {
              setAssignee(v);
              setPage(1);
              setSelected("");
            }}
            options={[
              { value: "", label: "All" },
              { value: "me", label: "Assigned to me" },
              { value: "unassigned", label: "Unassigned" },
              ...(data?.members || []).map((m) => ({
                value: m.id,
                label: m.name,
              })),
            ]}
          />
          <label className="marketing-inbox-check">
            <input
              type="checkbox"
              checked={unread}
              onChange={(e) => {
                setUnread(e.target.checked);
                setPage(1);
              }}
            />
            Unread only
          </label>
</>}/>
  </div>;
  const identity = c ? socialIdentity(withProfile(c)) : null;
  const timeline = current ? conversationTimeline(current) : [];
  useEffect(() => {
    if (historyRef.current && historyPage === 1)
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [c?.id, current?.messages?.length, historyPage]);
  function handling(patch) {
    return command("update", {
      status: c.status,
      priority: c.priority,
      assigned_to: c.assigned_to || "",
      tags: c.tags,
      takeover: c.takeover,
      ...patch,
    });
  }
  function suggestReply() {
    return mutate(
      { scope, id: c.id, version: c.version, kind: "reply" },
      (id) => inboxService.suggest(id, c, "reply"),
      "Suggestion prepared for review.",
    );
  }
  function reviewSuggestion(id, approve) {
    return mutate(
      { scope, artifact: id, approve },
      () => inboxService.reviewAI(id, approve),
      approve
        ? "Suggestion reviewed. Review the reply before sending."
        : "Suggestion dismissed.",
    );
  }
  return (
    <div className={`inbox-page ${selected ? "inbox-chat-open" : ""}`}>
      <WorkspacePage
        section="Marketing"
        title="Conversations"
        controls={controls}
        className="inbox-workspace-content"
        actions={
          <>
            <button
              className="btn-secondary"
              onClick={() => {
                setRefresh((r) => r + 1);
                inboxService
                  .configuration()
                  .then(setConfiguration)
                  .catch(() => {});
              }}
              disabled={busy}
            >
              <RefreshCw size={16} />
              Refresh
            </button>
            <ActionMenu
              open={actionsOpen}
              onOpenChange={setActionsOpen}
              ariaLabel="Conversation tools"
              trigger={({ open, toggle, ariaLabel }) => (
                <button
                  className="icon-btn"
                  aria-label={ariaLabel}
                  aria-expanded={open}
                  onClick={toggle}
                >
                  <MoreHorizontal size={18} />
                </button>
              )}
            >
              <button
                role="menuitem"
                onClick={() => {
                  setActionsOpen(false);
                  setModal({ type: "diagnostics" });
                }}
              >
                Diagnostics
              </button>
              {brand && (
                <button
                  role="menuitem"
                  disabled={busy || !data}
                  onClick={() => {
                    setActionsOpen(false);
                    setModal({
                      type: "settings",
                      policy: data?.policy || {
                        revision: 0,
                        automation_mode: "suggest",
                        ai_allowed: false,
                      },
                    });
                  }}
                >
                  FAQ & AI settings
                </button>
              )}
            </ActionMenu>
            {channel === "internal" && can("manage") && (
              <button
                className="btn-secondary"
                onClick={openCase}
                disabled={!brand || busy}
              >
                <Plus size={16} />
                Internal case
              </button>
            )}
          </>
        }
      >
        {error && (
          <p role="alert" className="text-danger inbox-feedback">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="inbox-feedback">
            {notice}
          </p>
        )}
        <div
          className={`marketing-inbox-grid ${selected ? "has-selection" : ""} ${detailsOpen ? "details-open" : ""}`}
        >
          <section className="marketing-inbox-list" aria-label="Conversations">
            <div className="inbox-list-heading">
              <h2>
                {channel === "internal" ? "Internal cases" : "Conversations"}
              </h2>
              <span>{data?.total ?? "—"}</span>
            </div>
            <div
              className="inbox-status-tabs"
              role="tablist"
              aria-label="Conversation status"
            >
              {["", "open", "pending", "resolved"].map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={status === v}
                  onClick={() => {
                    setStatus(v);
                    setPage(1);
                    setSelected("");
                  }}
                >
                  {v ? label(v) : "All"}
                </button>
              ))}
            </div>
            <div className="inbox-list-scroll">
              {loading && (
                <div role="status" className="inbox-list-skeleton">
                  Loading conversations…
                </div>
              )}
              {!loading && data?.rows.length === 0 && (
                <div className="marketing-inbox-empty">
                  <MessageSquareText size={28} />
                  <p>No conversations match your filters.</p>
                </div>
              )}
              {data?.rows.map((row) => (
                <button
                  className={`marketing-inbox-row ${selected === row.id ? "selected" : ""}`}
                  key={row.id}
                  aria-pressed={selected === row.id}
                  onClick={() => {
                    setSelected(row.id);
                    setHistoryPage(1);
                    setModal(null);
                    setPreview(null);
                    setDetailsOpen(false);
                  }}
                >
                  <CustomerAvatar conversation={withProfile(row)} />
                  <span className="inbox-row-content">
                    <span className="inbox-row-top">
                      <strong>{socialIdentity(withProfile(row)).name}</strong>
                      <time
                        title={stamp(row.latest_message_at || row.updated_at)}
                      >
                        {clock(row.latest_message_at || row.updated_at)}
                      </time>
                    </span>
                    <span className="inbox-row-preview">
                      {row.latest_message_kind === "note"
                        ? "Note: "
                        : row.latest_message_kind === "echo"
                          ? "You: "
                          : ""}
                      {row.latest_message || "No messages yet"}
                    </span>
                    <span className="inbox-row-bottom">
                      <span>
                        {row.brand_name} ·{" "}
                        {row.channel === "facebook"
                          ? "Messenger"
                          : label(row.channel)}
                        {row.medium === "comment" ? " · Comment" : ""}
                      </span>
                      {row.unread_count > 0 && (
                        <span
                          className="inbox-unread"
                          aria-label={`${row.unread_count} unread`}
                        >
                          {row.unread_count}
                        </span>
                      )}
                    </span>
                    <span className="inbox-row-assignment">
                      {row.assignee_name || "Unassigned"}
                      {row.priority === "high" || row.priority === "urgent"
                        ? ` · ${label(row.priority)}`
                        : ""}
                      {row.escalation_reasons?.length
                        ? " · Needs attention"
                        : ""}
                    </span>
                  </span>
                </button>
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
          </section>
          <section
            className="marketing-inbox-thread"
            aria-label="Conversation history"
          >
            {!c ? (
              <div className="marketing-inbox-empty">
                <MessageSquareText size={32} />
                <p>
                  {selected
                    ? "Loading conversation…"
                    : "Choose a conversation to start."}
                </p>
              </div>
            ) : (
              <>
                <header className="inbox-thread-header">
                  <button
                    className="icon-btn marketing-inbox-back"
                    aria-label="Back to conversations"
                    onClick={() => setSelected("")}
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <CustomerAvatar conversation={withProfile(c)} />
                  <div className="inbox-thread-identity">
                    <h2>{identity.name}</h2>
                    <p>
                      {data?.rows.find((r) => r.id === c.id)?.brand_name ||
                        brands.find((b) => b.id === c.brand_id)?.name}{" "}
                      ·{" "}
                      {c.channel === "facebook"
                        ? "Messenger"
                        : label(c.channel)}
                      {c.medium === "comment" ? " · Comment" : ""}
                    </p>
                  </div>
                  <span className="inbox-takeover-state">
                    {c.takeover ? "Human handling" : "AI suggestions"}
                    <small>Auto-replies off</small>
                  </span>
                  <button
                    className="icon-btn"
                    aria-label={
                      detailsOpen
                        ? "Hide customer details"
                        : "Show customer details"
                    }
                    aria-expanded={detailsOpen}
                    onClick={() => setDetailsOpen((v) => !v)}
                  >
                    <PanelRight size={18} />
                  </button>
                </header>
                <div className="inbox-header-controls">
                  <SelectField
                    label="Status"
                    value={c.status}
                    disabled={busy || !can("manage")}
                    onChange={(status) => handling({ status })}
                    options={options(["open", "pending", "resolved"])}
                  />
                  <SelectField
                    label="Assignment"
                    value={c.assigned_to || ""}
                    disabled={busy || !can("manage")}
                    onChange={(assigned_to) => handling({ assigned_to })}
                    options={[
                      { value: "", label: "Unassigned" },
                      ...(current.members || []).map((m) => ({
                        value: m.id,
                        label: m.name,
                      })),
                    ]}
                  />
                </div>
                {!!c.escalation_reasons?.length && (
                  <p role="status" className="marketing-inbox-escalation">
                    Needs a person: {c.escalation_reasons.map(label).join(", ")}
                    .
                  </p>
                )}
                <div
                  ref={historyRef}
                  className="marketing-inbox-history"
                  aria-label="Messages"
                >
                  {current.total > 30 && (
                    <div className="inbox-history-navigation">
                      <button
                        className="btn-secondary"
                        disabled={historyPage * 30 >= current.total}
                        onClick={() => setHistoryPage((p) => p + 1)}
                      >
                        Older messages
                      </button>
                      <button
                        className="btn-secondary"
                        disabled={historyPage === 1}
                        onClick={() => setHistoryPage((p) => p - 1)}
                      >
                        Newer messages
                      </button>
                    </div>
                  )}
                  {timeline.length === 0 && (
                    <p className="inbox-no-messages">No messages yet.</p>
                  )}
                  {timeline.map((m, index) => (
                    <div className="inbox-timeline-entry" key={m.id}>
                      {(index === 0 ||
                        day(timeline[index - 1].occurred_at) !==
                          day(m.occurred_at)) && (
                        <div className="inbox-date-separator">
                          <span>{day(m.occurred_at)}</span>
                        </div>
                      )}
                      <article
                        className={`marketing-inbox-message ${m.kind}`}
                        aria-label={
                          m.kind === "note"
                            ? "Internal note"
                            : m.kind === "echo"
                              ? "Outgoing message"
                              : "Incoming message"
                        }
                      >
                        {m.kind === "note" && (
                          <strong>
                            <span>Internal note</span> ·{" "}
                            {m.actor_name || "Team member"}
                          </strong>
                        )}
                        <p>
                          {m.body ||
                            (m.kind === "attachment"
                              ? "Attachment · preview unavailable"
                              : "Message content unavailable")}
                        </p>
                        <footer>
                          <time title={stamp(m.occurred_at)}>
                            {clock(m.occurred_at)}
                          </time>
                          {m.kind === "echo" && (
                            <span
                              className={`inbox-receipt ${m.send_state === "read" ? "read" : ""}`}
                            >
                              {["read", "delivered"].includes(m.send_state) ? (
                                <CheckCheck size={13} />
                              ) : m.send_state === "sent" ? (
                                <Check size={13} />
                              ) : null}
                              {["read", "delivered", "sent"].includes(
                                m.send_state,
                              )
                                ? label(m.send_state)
                                : "Status unavailable"}
                            </span>
                          )}
                        </footer>
                      </article>
                    </div>
                  ))}
                </div>
                <InboxReplyComposer
                  current={current}
                  configuration={
                    sendStatus?.key === detailKey
                      ? { ...configuration, ...sendStatus.data }
                      : { ...configuration, recipient_allowed: false }
                  }
                  can={can}
                  busy={busy}
                  command={command}
                  suggest={suggestReply}
                  reviewAI={reviewSuggestion}
                  preview={preview}
                  faqPreview={faqPreview}
                  onSend={(draft) => setModal({ type: "send", draft })}
                  onDirectSend={(text, sourceArtifactId) =>
                    mutate(
                      {
                        scope,
                        command: "staff_reply",
                        conversation: c.id,
                        version: c.version,
                        text,
                        sourceArtifactId,
                      },
                      (id) =>
                        inboxService.sendStaffReply(
                          id,
                          c,
                          text,
                          sourceArtifactId,
                        ),
                      "Reply attempt recorded. Check its status before retrying.",
                    )
                  }
                />
              </>
            )}
          </section>
          {c && detailsOpen && (
            <aside
              className="marketing-inbox-operations"
              aria-label="Customer details"
            >
              <div className="inbox-details-heading">
                <h2>Customer & handling</h2>
                <button
                  className="icon-btn"
                  aria-label="Close customer details"
                  onClick={() => setDetailsOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <CustomerAvatar conversation={withProfile(c)} />
              <h3>{identity.name}</h3>
              <p>
                {identity.known
                  ? "Social profile"
                  : "Customer profile unavailable"}
              </p>
              <p className="inbox-muted">
                Social identity · no verified FeedX customer link
              </p>
              <div className="inbox-handling-controls">
                {" "}
                <SelectField
                  label="Priority"
                  value={c.priority}
                  disabled={busy || !can("manage")}
                  onChange={(priority) => handling({ priority })}
                  options={options(["low", "normal", "high", "urgent"])}
                />
                <button
                  className="btn-secondary"
                  aria-pressed={c.takeover}
                  disabled={
                    busy ||
                    !can("manage") ||
                    c.opted_out ||
                    Boolean(c.escalation_reasons?.length)
                  }
                  onClick={() => handling({ takeover: !c.takeover })}
                >
                  {c.takeover ? "Human takeover on" : "Take over"}
                </button>
              </div>
              <dl>
                <dt>Assigned to</dt>
                <dd>
                  {current.members?.find((m) => m.id === c.assigned_to)?.name ||
                    "Unassigned"}
                </dd>
                <dt>Tags</dt>
                <dd>{c.tags.join(", ") || "No tags"}</dd>
                <dt>Language</dt>
                <dd>{c.language || "Unavailable"}</dd>
                <dt>Reply window</dt>
                <dd>
                  {c.channel === "internal"
                    ? "Internal case"
                    : current.window_open
                      ? `Until ${stamp(current.window_expires_at)}`
                      : "Closed or unavailable"}
                </dd>
              </dl>
              {c.opted_out && (
                <p role="status">Customer opted out. Replies paused.</p>
              )}
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
                      })
                    }
                  >
                    Edit handling & tags
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
                      onClick={() => setModal({ type: "resolve", reason: "" })}
                    >
                      Record escalation resolution
                    </button>
                  )}
                </>
              )}
              {c.summary && (
                <div className="marketing-inbox-summary">
                  <strong>
                    Team summary
                    {c.summary_version !== c.version ? " · update needed" : ""}
                  </strong>
                  <p>{c.summary}</p>
                </div>
              )}
              <details className="inbox-audit">
                <summary>Reply approvals & AI history</summary>
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
                      {d.source_version === c.version &&
                        d.status === "draft" &&
                        can("reply") && (
                          <button
                            className="btn-secondary"
                            disabled={busy}
                            onClick={() =>
                              command("review_reply", { draft_id: d.id })
                            }
                          >
                            Submit for review
                          </button>
                        )}
                      {d.source_version === c.version &&
                        d.status === "review" &&
                        can("approve") && (
                          <>
                            <button
                              className="btn-primary"
                              disabled={busy}
                              onClick={() =>
                                command("approve_reply", { draft_id: d.id })
                              }
                            >
                              Approve draft
                            </button>
                            <button
                              className="btn-secondary"
                              disabled={busy}
                              onClick={() =>
                                command("reject_reply", { draft_id: d.id })
                              }
                            >
                              Reject
                            </button>
                          </>
                        )}
                      {["draft", "review"].includes(d.status) &&
                        d.source_version === c.version &&
                        can("reply") && (
                          <button
                            className="btn-secondary"
                            disabled={busy}
                            onClick={() =>
                              command("cancel_reply", { draft_id: d.id })
                            }
                          >
                            Cancel
                          </button>
                        )}
                    </div>
                    {d.status === "approved" && (
                      <p className="text-sm text-text-secondary">
                        {d.source_version === c.version
                          ? "Approval recorded for this history version."
                          : "Historical approval; conversation history changed."}{" "}
                        Delivery:{" "}
                        {label(
                          current.outbox?.find((o) => o.draft_id === d.id)
                            ?.state || "blocked",
                        )}
                        .
                        {current.outbox?.find((o) => o.draft_id === d.id)
                          ?.provider_message_id && <> Receipt retained.</>}
                      </p>
                    )}
                  </article>
                ))}
                <h3>AI proposals · {current.artifacts.length} recent</h3>
                <p className="text-sm text-text-secondary">
                  Suggestions use approved facts. Human approval is required.
                  Provider:{" "}
                  {configuration?.ai_configured ? "Configured" : "Unavailable"}.
                </p>
                <div className="marketing-inbox-actions">
                  {can("ai") &&
                    ["summary", "faq"].map((kind) => (
                      <button
                        key={kind}
                        className="btn-secondary"
                        disabled={busy || !configuration?.ai_configured}
                        onClick={() =>
                          mutate(
                            { scope, id: c.id, version: c.version, kind },
                            (id) => inboxService.suggest(id, c, kind),
                            "AI request recorded. Review any verified proposal below.",
                          )
                        }
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
                      {a.model} · Input {a.input_tokens ?? "Unavailable"} /
                      output {a.output_tokens ?? "Unavailable"} tokens
                      {a.source_version !== c.version
                        ? " · History changed"
                        : ""}
                    </small>
                    {a.body.human_required && <p>Human handling required.</p>}
                    {a.state === "proposed" &&
                      a.source_version === c.version &&
                      can("approve") && (
                        <div className="marketing-inbox-actions">
                          <button
                            className="btn-primary"
                            disabled={busy}
                            onClick={() =>
                              mutate(
                                { scope, artifact: a.id, approve: true },
                                () => inboxService.reviewAI(a.id, true),
                                "Proposal approved. Replies and FAQs still require their own review.",
                              )
                            }
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
                              )
                            }
                          >
                            Reject
                          </button>
                        </div>
                      )}
                  </article>
                ))}
              </details>
              <details className="inbox-audit">
                <summary>Message evidence</summary>
                <p>Conversation version {c.version}</p>
                {[...current.messages, ...(current.audit_messages || [])]
                  .filter((m) => ["read", "delivery"].includes(m.kind))
                  .map((m) => (
                    <p key={m.id}>
                      {label(m.kind)} · {stamp(m.occurred_at)}
                    </p>
                  ))}
              </details>
            </aside>
          )}
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
            {modal.type === "diagnostics" ? (
              <div className="marketing-inbox-form">
                {" "}
                <details className="marketing-inbox-analytics">
                  <summary>Conversation performance</summary>
                  <div className="marketing-inbox-actions">
                    <Field
                      label="Conversations from"
                      type="date"
                      value={analyticsStart}
                      onChange={(e) => setAnalyticsStart(e.target.value)}
                    />
                    <Field
                      label="Conversations before"
                      type="date"
                      value={analyticsEnd}
                      onChange={(e) => setAnalyticsEnd(e.target.value)}
                    />
                  </div>
                  <p>
                    Conversations {metrics?.volume ?? "Unavailable"} ·
                    Unresolved {metrics?.unresolved ?? "Unavailable"} · Human
                    handovers {metrics?.human_handovers ?? "Unavailable"}
                  </p>
                  <p>
                    Median first response{" "}
                    {metrics?.first_response_seconds == null
                      ? "Unavailable"
                      : `${Math.round(metrics.first_response_seconds)}s`}{" "}
                    · AI acceptance{" "}
                    {metrics?.ai_acceptance_rate == null
                      ? "Unavailable"
                      : `${Math.round(metrics.ai_acceptance_rate * 100)}%`}{" "}
                    · Automation{" "}
                    {metrics?.automation_rate == null
                      ? "Unavailable"
                      : `${Math.round(metrics.automation_rate * 100)}%`}
                  </p>
                  <small>
                    Conversations created in the selected period ·
                    Asia/Kuala_Lumpur. Reply drafts are not sent responses.
                  </small>
                </details>
                <p className="text-sm text-text-secondary">
                  AI usage in this scope: {data?.ai_usage?.requests ?? 0}{" "}
                  requests · {data?.ai_usage?.input_tokens ?? "Unavailable"}{" "}
                  input / {data?.ai_usage?.output_tokens ?? "Unavailable"}{" "}
                  output tokens ·{" "}
                  {data?.ai_usage?.cost_available
                    ? `Estimated USD ${Number(data.ai_usage.cost).toFixed(6)}`
                    : "Costs unavailable"}
                  .
                </p>
                <div className="marketing-inbox-capabilities">
                  {data?.channels.map((v) => (
                    <div className="card p-3" key={v.connection_id}>
                      <strong>{v.account_name}</strong> · {label(v.channel)}{" "}
                      <State value={v.state} />
                      <p className="text-sm text-text-secondary">
                        Receive:{" "}
                        {v.receiving_verified ? "Verified" : "Unverified"} ·
                        Send:{" "}
                        {configuration?.staff_send_configured &&
                        v.receiving_verified
                          ? "Staff approval required"
                          : "Disabled"}{" "}
                        · Comments: {label(v.comments?.state || "unverified")}
                        {Object.entries(v.events || {})
                          .filter(
                            ([state, count]) =>
                              state !== "processed" && count > 0,
                          )
                          .map(
                            ([state, count]) =>
                              ` · ${count} ${label(state)} webhook events`,
                          )
                          .join("")}
                      </p>
                      {can("configure") && (
                        <button
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() =>
                            mutate(
                              {
                                scope,
                                connection: v.connection_id,
                                command: "verify_messaging",
                              },
                              async () => {
                                const evidence =
                                  await inboxService.verifyConnection(
                                    v.connection_id,
                                  );
                                return evidence;
                              },
                              (evidence) => {
                                setVerification({ scope, evidence });
                                return `App callback: ${evidence.app_webhook?.registered && evidence.app_webhook.active && evidence.app_webhook.callback_matches ? "Verified" : "Unverified"}. Missing permissions: ${evidence.missing_permissions.join(", ") || "None"}. Missing subscriptions: ${evidence.missing_subscriptions.join(", ") || "None"}. Task evidence: ${evidence.task_source}. Real inbound: ${evidence.real_inbound_verified ? "Verified" : "Unverified"}. Sending stays disabled.`;
                              },
                            )
                          }
                        >
                          Verify messaging
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {verification?.scope === scope && (
                  <details className="marketing-inbox-analytics">
                    <summary>Meta verification details</summary>
                    <p>
                      Account:{" "}
                      {verification.evidence.account_verified
                        ? "Verified"
                        : "Unverified"}{" "}
                      · Token:{" "}
                      {verification.evidence.token_verified
                        ? "Verified"
                        : "Unverified"}{" "}
                      · Authorization:{" "}
                      {verification.evidence.authorization_verified
                        ? "Verified"
                        : "Unverified"}
                    </p>
                    {verification.evidence.app_webhook && (
                      <p>
                        App webhook ({verification.evidence.app_webhook.object}
                        ):{" "}
                        {verification.evidence.app_webhook.registered
                          ? "Registered"
                          : "Absent"}{" "}
                        ·{" "}
                        {verification.evidence.app_webhook.active
                          ? "Active"
                          : "Inactive"}{" "}
                        · Callback destination:{" "}
                        {verification.evidence.app_webhook.callback_matches
                          ? "Matches"
                          : "Unverified"}{" "}
                        · Fields:{" "}
                        {verification.evidence.app_webhook.fields.join(", ") ||
                          "None"}
                      </p>
                    )}
                    {verification.evidence.evidence.map((row, index) => (
                      <p className="text-sm" key={index}>
                        {row.endpoint} · HTTP {row.http_status ?? "Unavailable"}{" "}
                        · Graph {row.graph_error_code ?? "None"} /{" "}
                        {row.graph_error_subcode ?? "None"}
                      </p>
                    ))}
                  </details>
                )}
              </div>
            ) : (
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
                send={(draft) =>
                  mutate(
                    { scope, command: "send", draft: draft.id },
                    (id) =>
                      inboxService.sendApproved(
                        current.outbox?.find((o) => o.draft_id === draft.id)
                          ?.execution_request || id,
                        draft.id,
                      ),
                    "Delivery attempt recorded. Review the receipt/status; do not resend an uncertain delivery.",
                  )
                }
              />
            )}
          </Modal>
        )}
      </WorkspacePage>
    </div>
  );
}
function InboxModal({
  modal: m,
  setModal,
  busy,
  data,
  can,
  members,
  command,
  configure,
  preview,
  send,
}) {
  const set = (k, v) => setModal((x) => ({ ...x, [k]: v }));
  if (m.type === "send")
    return (
      <div className="marketing-inbox-form">
        <p>
          This sends the exact approved reply to this conversation’s test
          recipient through its brand connection.
        </p>
        <p>{m.draft.body}</p>
        <button
          className="btn-primary"
          disabled={busy}
          onClick={() => send(m.draft)}
        >
          Confirm send
        </button>
      </div>
    );
  if (m.type === "settings") {
    return (
      <div className="marketing-inbox-form">
        <p>
          Automatic sending remains disabled. FAQ mode controls internal
          matching and proposed replies only.
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
          {Object.entries(data?.knowledge?.profile || {})
            .filter(([, v]) => v.provenance === "verified_brand_fact")
            .map(([k, v]) => (
              <p key={k}>
                <strong>{label(k)}:</strong> {v.text}
              </p>
            ))}
        </div>
        {can("approve") &&
          data?.knowledge &&
          !data.knowledge.approved_for_replies && (
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() =>
                configure("approve_knowledge", data.knowledge.revision)
              }
            >
              Approve this knowledge revision
            </button>
          )}
        {can("configure") && (
          <>
            <SelectField
              label="FAQ plan"
              value={m.policy.automation_mode || "suggest"}
              onChange={(v) =>
                set("policy", { ...m.policy, automation_mode: v })
              }
              options={options(["off", "suggest", "faq"])}
            />
            <label className="marketing-inbox-check">
              <input
                type="checkbox"
                checked={m.policy.ai_allowed}
                onChange={(e) =>
                  set("policy", { ...m.policy, ai_allowed: e.target.checked })
                }
              />
              Allow AI suggestions using approved facts and conversation history
              with direct contact details removed
            </label>
            <label className="marketing-inbox-check">
              <input
                type="checkbox"
                checked={Boolean(m.policy.staff_reply_requires_approval)}
                onChange={(e) =>
                  setModal({
                    ...m,
                    policy: {
                      ...m.policy,
                      staff_reply_requires_approval: e.target.checked,
                    },
                  })
                }
              />
              Require approval for all staff replies
            </label>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() =>
                configure("policy", m.policy.revision, {
                  automation_mode: m.policy.automation_mode,
                  ai_allowed: m.policy.ai_allowed,
                  staff_reply_requires_approval: Boolean(
                    m.policy.staff_reply_requires_approval,
                  ),
                })
              }
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
              })
            }
          >
            New FAQ
          </button>
        )}
        {data?.faqs.map((f) => (
          <article className="marketing-inbox-draft" key={f.id}>
            <strong>{f.question}</strong> <State value={f.status} />
            <p>{f.answer}</p>
            <small>
              {f.language} · Facts: {f.reference_keys.join(", ")} · Knowledge
              revision {f.knowledge_revision}
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
                      configure("approve_faq", f.revision, { id: f.id })
                    }
                  >
                    Approve exact FAQ
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() =>
                      configure("reject_faq", f.revision, { id: f.id })
                    }
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
          {Object.entries(data?.knowledge?.profile || {})
            .filter(([, v]) => v.provenance === "verified_brand_fact")
            .map(([k]) => (
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
                    )
                  }
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
            tags: m.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
            takeover: m.takeover,
          });
        } else if (m.type === "preview") {
          preview(m.question);
          setModal(null);
        } else if (m.type === "resolve") {
          command("clear_escalation", {
            reason: m.reason,
          });
        } else {
          command(
            m.type,
            m.type === "create" ? { title: m.title } : { body: m.body },
          );
        }
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
            />
            Human takeover (sensitive cases always retain this)
          </label>
        </>
      )}
      <button className="btn-primary" disabled={busy}>
        {busy ? "Saving…" : m.type === "preview" ? "Preview FAQ" : "Save"}
      </button>
    </form>
  );
}
