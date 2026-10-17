import {resolveBrandContext,selectBrandContext} from './brandContext.js';
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
  ArrowUpRight,
  StickyNote,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext.jsx";
import { WorkspaceSurface } from "../../components/layout/WorkspacePage.jsx";
import PanelResizeHandle from "../../components/layout/PanelResizeHandle.jsx";
import AdminSegmentedControl from "../../components/forms/AdminSegmentedControl.jsx";
import AdminUnderlineTabs from "../../components/navigation/AdminUnderlineTabs.jsx";
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
import InboxKnowledgeSettings from "./InboxKnowledgeSettings.jsx";
import {aiSuggestionUnavailable} from "./inboxKnowledge.js";
import { socialIdentity, conversationTimeline, replyOutcomeMessage, replyWasAccepted, replyStateLabel } from "./inboxPresentation.js";
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
          : ["review", "proposed", "human_takeover", "pending"].includes(value)
            ? "warning"
            : ["approved", "resolved", "open"].includes(value)
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
    [detailsOpen, setDetailsOpen] = useState(() => window.matchMedia?.("(min-width: 1280px)").matches || false),
    [actionsOpen, setActionsOpen] = useState(false),
    [sendStatus, setSendStatus] = useState(null);
  const composerDrafts = useRef(new Map());
  const contextPanelRef = useRef(null), contextToggleRef = useRef(null);
  const [wideContext, setWideContext] = useState(() => window.matchMedia?.("(min-width: 1280px)").matches || false);
  const workspaceRef = useRef(null), followMessages = useRef(true);
  const [contextTab, setContextTab] = useState('profile');
  const [panelWidths, setPanelWidths] = useState({ list: 340, context: 290 });
  useEffect(() => {
    const media = window.matchMedia?.('(min-width: 1280px)');
    if (!media) return;
    const adapt = () => { setWideContext(media.matches); setDetailsOpen(media.matches); };
    media.addEventListener('change', adapt);
    return () => media.removeEventListener('change', adapt);
  }, []);
  useEffect(() => {
    if (!workspaceRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (window.innerWidth < 1280) return;
      const available = entry.contentRect.width - 360;
      setPanelWidths(widths => {
        const context = detailsOpen ? Math.min(widths.context,Math.max(260,available-260)) : widths.context;
        const list = Math.min(widths.list,Math.max(260,available-(detailsOpen?context:0)));
        return list === widths.list && context === widths.context ? widths : {list,context};
      });
    });
    observer.observe(workspaceRef.current);
    return () => observer.disconnect();
  }, [detailsOpen]);
  useEffect(() => {
    if (detailsOpen && !wideContext) contextPanelRef.current?.focus();
  }, [detailsOpen,wideContext]);
  function closeContext() {
    setDetailsOpen(false);
    requestAnimationFrame(() => contextToggleRef.current?.focus());
  }
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
          const q=new URLSearchParams(window.location.search),queryOrg=q.get("marketing_org"),queryBrand=q.get("marketing_brand");const next=resolveBrandContext(v,queryBrand,queryOrg);setOrg(next.org);setBrand(next.brand);
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
    composerDrafts.current.clear();
    setPage(1);
    setSelected("");
    setContextTab("profile");
    setModal(null);
    setNotice("");
    setPreview(null);
    setBusy(false);
    request.current = null;
    generation.current++;
  }, [scope]);
  const openedDashboardConversation=useRef('');
  useEffect(()=>{const id=new URLSearchParams(window.location.search).get('conversation_id');if(!data||!id||openedDashboardConversation.current===id)return;openedDashboardConversation.current=id;setSelected(id);const url=new URL(window.location.href);url.searchParams.delete('conversation_id');window.history.replaceState(window.history.state,'',url);},[data]);
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
      const isSend = ['staff_reply','send'].includes(intent.command);
      setNotice(isSend ? replyOutcomeMessage(result) : typeof message === "function" ? message(result) : message);
      setRefresh((r) => r + 1);
      notifyConversationsChanged();
      if (intent.command === "create") {
        setChannel("internal");
        setSelected(result.conversation.id);
      }
      return isSend && !replyWasAccepted(result) ? null : result;
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
  async function configure(name, revision, payload = {}) {
    const expectedScope = activeScope.current;
    const result = await mutate({ command: name, scope, revision, payload }, (id) =>
      inboxService.configure(id, brand, revision, name, payload));
    if (result && expectedScope === activeScope.current) setModal({type:'settings'});
    return result;
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
  const latestQuestion = historyPage === 1 ? [...(current?.messages||[])].reverse().find(m=>m.kind==='incoming')?.body : '';
  const mayMatchFAQ = can('reply');
  useEffect(()=>{
    let live=true;setPreview(null);
    if(c?.id && mayMatchFAQ && latestQuestion?.trim() && latestQuestion.length<=500)
      inboxService.preview(c.id,latestQuestion).then(value=>{if(live)setPreview(value)}).catch(()=>{if(live)setPreview({state:'unavailable'})});
    return ()=>{live=false};
  },[c?.id,c?.version,current?.knowledge?.revision,current?.knowledge?.approved_for_replies,current?.policy?.automation_mode,latestQuestion,mayMatchFAQ]);
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
    const ids = JSON.parse(profileIds);
    if (ids.length)
      inboxService
        .profiles(ids)
        .then(() => {
          // Canonical list/detail projections remain the only display authority.
          if (live && activeScope.current === scope) setRefresh((r) => r + 1);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [scope, profileIds]);
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
  const controls = <AdminFilterToolbar compact denseFields ariaLabel="Conversation filters" className="inbox-list-filters" moreFiltersIconOnly
    filters={<>
      <SelectField searchable="auto" ariaLabel="Brand" value={brand}
        onChange={value => selectBrandContext(context,value,org,setOrg,setBrand)}
        options={[{value:'',label:'All Brands'},...context.brands.map(b=>({value:b.id,label:b.name}))]} />
      <SelectField ariaLabel="Channel" value={channel} onChange={value=>{setChannel(value);setPage(1);setSelected('');}}
        options={[{value:'social',label:'All Channels'},{value:'facebook',label:'Messenger'},{value:'instagram',label:'Instagram'},{value:'internal',label:'Internal cases'}]} />
    </>}
    moreFilters={<><SelectField label="Assignee" value={assignee} onChange={value=>{setAssignee(value);setPage(1);setSelected('');}}
      options={[{value:'',label:'All'},{value:'me',label:'Assigned to me'},{value:'unassigned',label:'Unassigned'},...(data?.members||[]).map(m=>({value:m.id,label:m.name}))]} />
      <label className="marketing-inbox-check"><input type="checkbox" checked={unread} onChange={event=>{setUnread(event.target.checked);setPage(1);}}/>Unread only</label></>} />;
  const identity = c ? socialIdentity(c) : null;
  const timeline = current ? conversationTimeline(current) : [];
  useEffect(() => {
    if (historyRef.current && historyPage === 1 && followMessages.current)
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
      <WorkspaceSurface tone="workspace" className="inbox-workspace-content" aria-label="Conversations workspace">
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
          ref={workspaceRef}
          style={{'--inbox-list-width': `${panelWidths.list}px`, '--inbox-context-width': `${panelWidths.context}px`}}
          className={`marketing-inbox-grid ${selected ? "has-selection" : ""} ${detailsOpen ? "details-open" : ""}`}
        >
          <section className="marketing-inbox-list" aria-label="Conversations" inert={detailsOpen && !wideContext}>
            <div className="inbox-list-heading"><h1>{channel === 'internal' ? 'Internal cases' : 'Conversations'}</h1>
              <span className="inbox-list-count">{data?.total ?? '—'}</span>
              <div className="inbox-list-commands"><>
            <button
              className="icon-btn"
              aria-label="Refresh"
              title="Refresh conversations"
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
              <span className="sr-only">Refresh</span>
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
              {(
                <button
                  role="menuitem"
                  title={!brand?'Select a Brand filter to manage its FAQs and AI settings.':undefined}
                  disabled={busy || !data || !brand}
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
          </></div>
            </div>
            <div className="inbox-list-search"><AdminSearchField hideLabel label="Search" ariaLabel="Search conversations" placeholder="Search messages or keywords…" value={search} maxLength={100} onChange={value=>{setSearch(value);setPage(1);setSelected('');}} /></div>
            <AdminSegmentedControl className="inbox-status-tabs" label="Conversation status" value={status}
              onChange={value=>{setStatus(value);setPage(1);setSelected('');}}
              options={['','open','pending','resolved'].map(value=>({value,label:value?label(value):'All'}))} />
            {controls}
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
                    followMessages.current = true;
                  }}
                >
                  <CustomerAvatar conversation={row} />
                  <span className="inbox-row-content">
                    <span className="inbox-row-top">
                      <strong>{socialIdentity(row).name}</strong>
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
                          ? "Sent: "
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
                      <State value={row.status} />{row.assignee_name ? <span>{row.assignee_name}</span> : null}
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
              compact
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
          <PanelResizeHandle label="Conversation list width" value={panelWidths.list} min={260} max={420}
            onChange={value=>setPanelWidths(widths=>({...widths,list:Math.min(value,Math.max(260,(workspaceRef.current?.clientWidth||1200)-(detailsOpen?widths.context+16:8)-340))}))} />
          <section
            className="marketing-inbox-thread"
            inert={detailsOpen && !wideContext}
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
                  <CustomerAvatar conversation={c} />
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
<div className={`inbox-header-controls inbox-status-${c.status}`}>
                  <SelectField
                    ariaLabel="Status"
                    value={c.status}
                    disabled={busy || !can("manage")}
                    onChange={(status) => handling({ status })}
                    options={options(["open", "pending", "resolved"])}
                  />
                  <SelectField
                    ariaLabel="Assignment"
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
                  <button
                    className="icon-btn"
                    ref={contextToggleRef}
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
                {!!c.escalation_reasons?.length && (
                  <p role="status" className="marketing-inbox-escalation">
                    Needs a person: {c.escalation_reasons.map(label).join(", ")}
                    .
                  </p>
                )}
                <div
                  ref={historyRef}
                  className="marketing-inbox-history"
                  onScroll={event=>{const el=event.currentTarget;followMessages.current=el.scrollHeight-el.scrollTop-el.clientHeight<96;}}
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
                          {m.kind === "echo" && m.message_origin === "meta" ? <span>Meta · </span> : null}
                          {m.evidence_source === "historical_import" ? <span>Imported history · </span> : m.evidence_source === "recent_api" ? <span>Recovered from Meta · </span> : null}
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
                                ? replyStateLabel(m.send_state)
                                : "Status unavailable"}
                            </span>
                          )}
                        </footer>
                      </article>
                    </div>
                  ))}
                </div>
                <InboxReplyComposer
                  key={`${scope}:${c.id}`}
                  draftCache={composerDrafts.current}
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
          {detailsOpen && <PanelResizeHandle label="Customer context width" value={panelWidths.context} min={260} max={360} reverse
            onChange={value=>setPanelWidths(widths=>({...widths,context:Math.min(value,Math.max(260,(workspaceRef.current?.clientWidth||1200)-widths.list-16-340))}))} />}
          {detailsOpen && (
            <aside
              className="marketing-inbox-operations"
              aria-label="Customer details"
              ref={contextPanelRef}
              tabIndex={-1}
              onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();closeContext();}}}
            >
              <div className="inbox-details-heading">
                <h2>Customer Context</h2>
                <button
                  className="icon-btn"
                  aria-label="Close customer details"
                  onClick={closeContext}
                >
                  <X size={18} />
                </button>
              </div>
              {!c ? <div className="marketing-inbox-empty"><UserRound size={30}/><p>Select a conversation to see customer context.</p></div> : <>
              <div className="inbox-context-identity"><CustomerAvatar conversation={c} /><div><h3>{identity.name}</h3><p>{c.channel === 'facebook' ? 'Messenger' : label(c.channel)}{c.customer_profile?.handle ? ` · @${c.customer_profile.handle}` : ''}</p></div></div>
              <AdminUnderlineTabs ariaLabel="Customer context" value={contextTab} onChange={setContextTab} tabs={[{value:'profile',label:'Profile'},{value:'history',label:'History'},{value:'notes',label:'Notes'}]} />
              {contextTab === 'profile' && <div className="inbox-context-section">
              {!identity.known && <p className="inbox-profile-unavailable">{identity.unavailableReason}</p>}
                  <span className="inbox-takeover-state">
                    {c.takeover ? "Human handling" : "AI suggestions"}
                    <small>Auto-replies off</small>
                  </span>

              <h3>Basic information</h3><dl>
                <dt>Name</dt><dd>{identity.known ? identity.name : 'Not available from Meta'}</dd>
                <dt>Brand</dt><dd>{data?.rows.find(row=>row.id===c.id)?.brand_name || brands.find(b=>b.id===c.brand_id)?.name || 'Unavailable'}</dd>
                <dt>Channel</dt><dd>{c.channel === 'facebook' ? 'Messenger' : label(c.channel)}</dd>
              </dl>
              <section className="inbox-crm-context"><h3>CRM customer</h3><p className="inbox-muted">No verified CRM customer link. Contact details are unavailable.</p>
                {auth.hasPermission('marketing_audience.view') && <a className="btn-secondary" href="/marketing/customers">Open Customer Directory<ArrowUpRight size={14}/></a>}
              </section>
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
              </div>}
              {contextTab === 'notes' && <section className="inbox-context-section"><h3>Internal notes</h3>
                <p className="inbox-muted">Team-only notes from the loaded conversation history. Add a note using Internal note in the composer.</p>
                {current.messages.filter(message=>message.kind==='note').length ? current.messages.filter(message=>message.kind==='note').map(message=><article className="inbox-context-note" key={message.id}><strong>{message.actor_name||'Team member'}</strong><p>{message.body}</p><time>{stamp(message.occurred_at)}</time></article>) : <div className="inbox-context-empty"><StickyNote size={22}/><p>No notes in the loaded history.</p></div>}
              </section>}
              {contextTab === 'history' && <section className="inbox-context-section"><h3>Conversation history</h3><dl>
                <dt>Recorded since</dt><dd>{c.created_at ? stamp(c.created_at) : 'Unavailable'}</dd>
                <dt>Last inbound</dt><dd>{c.last_inbound_at ? stamp(c.last_inbound_at) : 'Unavailable'}</dd>
                <dt>History entries</dt><dd>{current.total ?? 'Unavailable'}</dd>
              </dl><p className="inbox-muted">This conversation only. Other Pages and customers are not matched by name.</p>
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
                        {replyStateLabel(
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
                        disabled={busy || Boolean(aiSuggestionUnavailable(current,configuration))}
                        title={aiSuggestionUnavailable(current,configuration)}
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
              </section>}
              </>}
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
                configuration={configuration}
                knowledgeHref={auth.hasPermission('marketing_settings.view') ? `/marketing/brand-knowledge?marketing_brand=${brand}&marketing_org=${org}` : null}
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
      </WorkspaceSurface>
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
  configuration,
  knowledgeHref,
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
  if (m.type === "settings") return <InboxKnowledgeSettings data={data} configuration={configuration} can={can} busy={busy} configure={configure} onKnowledge={knowledgeHref} onEdit={faq=>setModal({type:'faq',...faq})}/>;
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
            category: m.category,
            alternative_questions: m.alternativeText !== undefined ? m.alternativeText.split("\n").map(v=>v.trim()).filter(Boolean) : (m.alternative_questions||[]),
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
        <Field label="Category" value={m.category||'General'} maxLength={80} required onChange={e=>set('category',e.target.value)}/>
        <Area label="Alternative questions (optional)" value={m.alternativeText ?? (m.alternative_questions||[]).join('\n')} maxLength={5010} onChange={e=>set('alternativeText',e.target.value)} />
        <p>One phrasing per line, up to 10. Matching is exact apart from spacing and capitalization; edits require a new approval.</p>
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
        <button type="button" className="btn-secondary" disabled={busy} onClick={()=>setModal({type:'settings'})}>Back to FAQ Library</button>
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
