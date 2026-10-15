import AdminCalendarNavigation from '../../components/forms/AdminCalendarNavigation.jsx';
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Image,
  List,
  Eye,
  SlidersHorizontal,
} from "lucide-react";
import { useAuth } from "../../auth/AuthContext.jsx";
import AdminFilterToolbar from "../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../components/forms/AdminSearchField.jsx";
import FeedXDateRangePicker from "../../components/ui/FeedXDateRangePicker.jsx";
import AdminSegmentedControl from "../../components/forms/AdminSegmentedControl.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
import DataTable from "../../components/tables/DataTable.jsx";
import AdminPagination, {
  useAdminPagedQuery,
} from "../../components/tables/AdminPagination.jsx";
import AsyncDataSurface from "../../components/feedback/AsyncDataSurface.jsx";
import Modal from "../../components/feedback/Modal.jsx";
import ActionMenu from "../../components/ui/ActionMenu.jsx";
import PostDetail from "./PostDetail.jsx";
import Channel from "./SocialChannelIcon.jsx";
import Badge from "../../components/ui/Badge.jsx";
import { marketingService } from "./marketingService.js";
import { calendarRange, localInput } from "./marketingCalendar.js";
import {
  CONTENT_TIMEZONE,
  POST_METRICS, postMetric, metricReason, preferredMetricColumns, saveMetricColumns,
  contentBounds,
  contentStatusLabel,
  preferredContentView,
  saveContentView,
  shiftContentPeriod,
} from "./contentManagement.js";
import "./contentManagement.css";

const channels = [{ value: "", label: "All" }, {
  value: "facebook",
  label: "Facebook",
}, { value: "instagram", label: "Instagram" }];
const statuses = [
  { value: "", label: "All" },
  ...[
    "draft",
    "review",
    "approved",
    "scheduled",
    "published",
    "failed",
    "rejected",
    "cancelled",
  ].map((value) => ({ value, label: contentStatusLabel(value) })),
];
const sorting = [
  { value: "date_desc", label: "Newest first" },
  { value: "date_asc", label: "Oldest first" },
  { value: "title", label: "Content A–Z" },
  { value: "brand", label: "Brand" },
  { value: "status", label: "Status" },
];
const groups = [
  { value: "", label: "No grouping" },
  { value: "date", label: "Date" },
  { value: "brand", label: "Brand" },
  { value: "status", label: "Status" },
];
const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat("en-MY", {
      timeZone: CONTENT_TIMEZONE,
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(value))
    : "Unavailable";
const formatTime = (value) =>
  value
    ? new Intl.DateTimeFormat("en-MY", {
      timeZone: CONTENT_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value))
    : "";
const safePermalink = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
        /(^|\.)(facebook\.com|instagram\.com)$/.test(u.hostname)
      ? value
      : null;
  } catch {
    return null;
  }
};
function Status({ value }) {
  return (
    <Badge
      tone={["failed", "rejected"].includes(value)
        ? "danger"
        : value === "published" || value === "approved"
        ? "success"
        : ["review", "scheduled"].includes(value)
        ? "warning"
        : "neutral"}
    >
      {contentStatusLabel(value)}
    </Badge>
  );
}
export function Thumbnail({ channel }) {
  const [url, setUrl] = useState(channel?.thumbnail_url || "");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    setUrl(channel?.thumbnail_url || "");
    if (channel?.asset?.mime_type?.startsWith("image/")) {
      marketingService.assetUrl(channel.asset).then((value) => {
        if (live) setUrl(value);
      }).catch(() => {
        if (live) setFailed(true);
      });
    }
    return () => {
      live = false;
    };
  }, [channel?.asset?.id, channel?.thumbnail_url]);
  return (
    <span className="cm-thumbnail">
      {url && !failed
        ? (
          <img
            src={url}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        )
        : (
          <Image
            size={18}
            aria-label={failed ? "Preview unavailable" : "No image preview"}
          />
        )}
    </span>
  );
}
function Performance({ channel, published, metricKeys = ["reach", "views", "interactions"] }) {
  if (!published) return <span className="cm-muted">—</span>;
  if (!channel) return <span className="cm-muted">Per channel below</span>;
  return (
    <span className="cm-performance">
      {metricKeys.map((name) => {
        const value = postMetric(channel, name);
        return (
          <span key={name}>
            <span>{POST_METRICS.find(m=>m.key===name)?.label || contentStatusLabel(name)}</span>{" "}
            <strong
              title={metricReason(channel,name)||POST_METRICS.find(m=>m.key===name)?.description}
            >
              {value === null ? "Unavailable" : value.toLocaleString("en-MY")}
            </strong>
          </span>
        );
      })}
    </span>
  );
}
function PublishDate({ row, channel }) {
  const actual = channel ? channel.actual_at : row.actual_at;
  const value = actual || row.scheduled_at || row.planned_at;
  return (
    <span className="cm-date">
      <strong>{formatDate(value)}</strong>
      <small>{formatTime(value)}</small>
    </span>
  );
}
function Evidence({ channel }) {
  return (
    <span className="cm-evidence">
      {channel.job_state
        ? `Delivery: ${contentStatusLabel(channel.job_state)}`
        : null}
      {channel.error_code
        ? ` · ${channel.error_code.replaceAll("_", " ")}`
        : null}
      {channel.provider_post_id ? ` · Post ${channel.provider_post_id}` : null}
      {channel.observed_at
        ? ` · Observed ${formatDate(channel.observed_at)}`
        : null}
    </span>
  );
}

export default function ContentManagement(
  { organizationId, brandId, refresh, open, command, busy, can },
) {
  const auth = useAuth();
  const [view, setView] = useState(() => preferredContentView(auth.user?.id));
  const [mode, setMode] = useState("month");
  const [anchor, setAnchor] = useState(() =>
    localInput(new Date(), CONTENT_TIMEZONE).slice(0, 10)
  );
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState(()=>{const value=new URLSearchParams(window.location.search).get("status");return statuses.some(s=>s.value===value)?value:"";});
  const [sort, setSort] = useState("date_desc");
  const [group, setGroup] = useState("");
  const [expanded, setExpanded] = useState({});
  const [external, setExternal] = useState(null);
  const [metricColumns,setMetricColumns]=useState(()=>preferredMetricColumns(auth.user?.id));
  const [columnsOpen,setColumnsOpen]=useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setExternal(null);
    setExpanded({});
  }, [organizationId, brandId, auth.user?.id]);
  useEffect(() => {
    setView(preferredContentView(auth.user?.id));
    setMetricColumns(preferredMetricColumns(auth.user?.id));
  }, [auth.user?.id]);
  const bounds = useMemo(() => {
    try {
      return contentBounds({ view, anchor, mode, from, to });
    } catch (e) {
      return { error: e.message };
    }
  }, [view, anchor, mode, from, to]);
  const signature = JSON.stringify([
    organizationId,
    brandId,
    auth.user?.id,
    view,
    bounds,
    query,
    channel,
    status,
    sort,
    group,
    refresh,
  ]);
  const [state, actions] = useAdminPagedQuery({
    storageKey: `marketing.content-management.${auth.user?.id}`,
    querySignature: signature,
    enabled: Boolean(organizationId && brandId) && !bounds.error,
    shouldClearOnError: () => true,
    loadPage: async ({ page, pageSize }) => {
      if (bounds.empty) {
        return { rows: [], total_count: 0, summary: { day_counts: {} } };
      }
      const result = await marketingService.contentManagement({
        organizationId,
        brandId,
        ...bounds,
        search: query,
        channel,
        status,
        sort,
        group,
        page,
        pageSize,
        view,
      });
      return { ...result, summary: { day_counts: result.day_counts } };
    },
  });
  const current = state.loadedQuerySignature === signature;
  const rows = current ? state.rows : [];
  const loading = state.loading || !current && !state.error && !bounds.error;
  const range = useMemo(() => calendarRange(anchor, mode, CONTENT_TIMEZONE), [
    anchor,
    mode,
  ]);
  function changeView(value) {
    setView(value);
    saveContentView(auth.user?.id, value);
  }
  function show(row) {
    if (row.origin === "meta") setExternal(row);
    else open({ type: "review", content: row });
  }
  function rowActions(row) {
    return <button type="button" className="icon-btn" aria-label={`View ${row.title}`} title="View post" onClick={() => show(row)}><Eye size={16}/></button>;
  }
  function contentCell(row, variant = null) {
    const media = variant || row.channels.find(v=>v.thumbnail_url || v.asset?.mime_type?.startsWith("image/")) || row.channels[0];
    return (
      <div className="cm-content">
        <Thumbnail channel={media} />
        <div className="cm-copy">
          <button className="cm-title" onClick={() => show(row)}>
            {variant
              ? variant.caption || contentStatusLabel(variant.channel)
              : row.title}
          </button>
          {!variant
            ? (
              <span className="cm-caption">
                {row.origin === "meta"
                  ? "Published externally · Meta"
                  : row.channels[0]?.caption}
              </span>
            )
            : <span className="cm-muted">{variant.job_state ? contentStatusLabel(variant.job_state) : contentStatusLabel(variant.status)}</span>}
          {!variant && row.channels.length > 1
            ? (
              <button
                className="cm-expand"
                aria-expanded={Boolean(expanded[row.key])}
                onClick={() =>
                  setExpanded((v) => ({ ...v, [row.key]: !v[row.key] }))}
              >
                {expanded[row.key]
                  ? <ChevronUp size={13} />
                  : <ChevronDown size={13} />}
                {row.channels.length} channel variants
              </button>
            )
            : null}
        </div>
      </div>
    );
  }
  const tableRows = [];
  let previousGroup;
  rows.forEach((row) => {
    if (group && row.group_key !== previousGroup) {
      tableRows.push({
        key: `group:${row.group_key}`,
        heading: group === "status"
          ? contentStatusLabel(row.group_key)
          : row.group_key,
      });
      previousGroup = row.group_key;
    }
    tableRows.push({ ...row, parent: row });
    if (expanded[row.key]) {
      row.channels.forEach((variant) =>
        tableRows.push({
          ...row,
          key: `${row.key}:${variant.channel}`,
          parent: row,
          variant,
        })
      );
    }
  });
  const columns = [
    {
      key: "content",
      header: "Content",
      width: "280px",
      render: (row) =>
        row.heading
          ? <strong>{row.heading}</strong>
          : contentCell(row.parent, row.variant),
    },
    {
      key: "channel",
      header: "Channel",
      width: "64px",
      render: (row) =>
        row.heading ? null : (
          <div className="cm-channels">
            {(row.variant ? [row.variant] : row.channels).map((v) => (
              <Channel key={v.channel} value={v.channel} />
            ))}
          </div>
        ),
    },
    {
      key: "date",
      header: "Publish Date",
      width: "140px",
      render: (row) =>
        row.heading ? null : <PublishDate row={row} channel={row.variant} />,
    },
    {
      key: "status",
      header: "Status",
      width: "110px",
      render: (row) =>
        row.heading
          ? null
          : <Status value={row.variant?.status || row.status} />,
    },
    ...metricColumns.map(key=>({key, header:POST_METRICS.find(m=>m.key===key).label, width:"76px", headerClassName:"whitespace-nowrap", align:"right",render:row=>{
      if(row.heading)return null;
      const v=row.variant||(row.channels.length===1?row.channels[0]:null),value=postMetric(v,key);
      return <span className="cm-metric" title={v?metricReason(v,key)||POST_METRICS.find(m=>m.key===key).description:'Expand for channel-specific metrics'}>{value===null?'—':value.toLocaleString('en-MY')}</span>;
    }})),
    {
      key: "actions",
      header: "Actions",
      width: "48px",
      render: (row) => row.heading || row.variant ? null : rowActions(row),
    },
  ];
  return (
    <div className="cm-root">
      <div className="cm-heading">
        <AdminSegmentedControl
          value={view}
          onChange={changeView}
          label="Content view"
          options={[{
            value: "list",
            label: (
              <>
                <List size={14} /> List
              </>
            ),
          }, {
            value: "calendar",
            label: (
              <>
                <CalendarDays size={14} /> Calendar
              </>
            ),
          }]}
        />
        <div className="cm-heading-tools"><span className="cm-muted">{current ? `${state.total} content records · ` : ""}Asia/Kuala_Lumpur</span>{view==='list'?<ActionMenu open={columnsOpen} onOpenChange={setColumnsOpen} ariaLabel="Metric columns" width={224} trigger={({toggle,open})=><button className="btn-secondary" aria-haspopup="menu" aria-expanded={open} onClick={toggle}><SlidersHorizontal size={14}/> Columns</button>}><fieldset className="admin-column-picker"><legend>Performance columns</legend>{POST_METRICS.filter(m=>!m.unit).map(m=><label key={m.key}><input type="checkbox" checked={metricColumns.includes(m.key)} onChange={e=>{const next=e.target.checked?[...metricColumns,m.key]:metricColumns.filter(k=>k!==m.key);setMetricColumns(next);saveMetricColumns(auth.user?.id,next)}}/>{m.label}</label>)}</fieldset></ActionMenu>:null}</div>
      </div>
      <AdminFilterToolbar
        compact
        denseFields
        ariaLabel="Content filters"
        search={<AdminSearchField label="Search" ariaLabel="Search content" placeholder="Title or caption" value={search} maxLength={200} onChange={setSearch}/>}
        period={<FeedXDateRangePicker from={from} to={to} today={localInput(new Date(), CONTENT_TIMEZONE).slice(0,10)} onApply={({from: start,to: end})=>{setFrom(start);setTo(end);if(view==='calendar'&&start)setAnchor(start)}}/>}
        periodAfterFilters
        filters={
          <>
            <SelectField
              label="Channel"
              value={channel}
              onChange={setChannel}
              options={channels}
            />
            <SelectField
              label="Status"
              value={status}
              onChange={setStatus}
              options={statuses}
            />
          </>
        }
        moreFilters={
          <>
            <SelectField
              label="Sort"
              value={sort}
              onChange={setSort}
              options={sorting}
            />
            <SelectField
              label="Group by"
              value={group}
              onChange={setGroup}
              options={groups}
            />
          </>
        }
        activeFilters={[
          search
            ? {
              key: "search",
              label: "Search",
              value: search,
              onRemove: () => {
                setSearch("");
                setQuery("");
              },
            }
            : null,
          from
            ? {
              key: "from",
              label: "From",
              value: from,
              onRemove: () => setFrom(""),
            }
            : null,
          to
            ? { key: "to", label: "To", value: to, onRemove: () => setTo("") }
            : null,
          channel
            ? {
              key: "channel",
              label: "Channel",
              value: contentStatusLabel(channel),
              onRemove: () => setChannel(""),
            }
            : null,
          status
            ? {
              key: "status",
              label: "Status",
              value: contentStatusLabel(status),
              onRemove: () => setStatus(""),
            }
            : null,
        ].filter(Boolean)}
        onClear={() => {
          setSearch("");
          setQuery("");
          setFrom("");
          setTo("");
          setChannel("");
          setStatus("");
        }}
      />
      {view === "calendar"
        ? (
          <div className="cm-period">
            <AdminCalendarNavigation value={anchor} onChange={setAnchor} onPrevious={()=>setAnchor(shiftContentPeriod(anchor,mode,-1))} onNext={()=>setAnchor(shiftContentPeriod(anchor,mode,1))}/>
            <AdminSegmentedControl
              label="Calendar period"
              value={mode}
              onChange={setMode}
              options={[{ value: "month", label: "Month" }, {
                value: "week",
                label: "Week",
              }]}
            />
          </div>
        )
        : null}
      {current && view === "calendar" && !rows.length && !bounds.error
        ? (
          <p className="cm-muted" role="status">
            No dated content in this period.
          </p>
        )
        : null}
      <AsyncDataSurface
        loading={loading}
        error={bounds.error || state.error}
        hasData={current && rows.length > 0 && !bounds.error}
        isEmpty={current && rows.length === 0 && !bounds.error &&
          view === "list"}
        emptyTitle={view==="calendar"?"No dated content":"No content yet"}
        emptyDescription={view==="calendar"?"Try another period or filter. Unscheduled drafts are available in List view.":"Create a post or adjust your filters."}
        onRetry={bounds.error ? undefined : actions.retry}
      >
        {current && !bounds.error && view === "list"
          ? (
            <>
              <div className="cm-desktop card">
                <DataTable
                  columns={columns}
                  rows={tableRows}
                  getRowKey={(row) => row.key}
                  getRowProps={row => row.heading ? {} : { tabIndex: 0, "aria-label": `View ${row.title}`, onClick: () => show(row.parent), onKeyDown: event => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); show(row.parent); } } }}
                  density="compact"
                  columnSpacing="compact"
                  minWidth={642 + 76 * metricColumns.length}
                  tableClassName="cm-table"
                  getRowClassName={(row) =>
                    row.heading
                      ? "cm-group-row"
                      : row.variant
                      ? "cm-variant-row"
                      : ""}
                />
              </div>
              <div className="cm-mobile">
                {tableRows.filter((row) => !row.variant).map((row) =>
                  row.heading
                    ? <h2 key={row.key}>{row.heading}</h2>
                    : (
                      <article className="card cm-mobile-row" key={row.key} tabIndex={0} aria-label={`View ${row.title}`} onClick={event=>{if(!event.target.closest("button, a, input"))show(row)}} onKeyDown={event=>{if(event.target===event.currentTarget&&["Enter"," "].includes(event.key)){event.preventDefault();show(row)}}}>
                        {contentCell(row)}
                        <div className="cm-mobile-meta">
                          <Status value={row.status} />
                          <PublishDate row={row} />
                        </div>
                        <div className="cm-channels">
                          {row.channels.map((v) => (
                            <Channel key={v.channel} value={v.channel} />
                          ))}
                        </div>
                        <Performance
                            metricKeys={metricColumns}
                          channel={row.channels.length === 1
                            ? row.channels[0]
                            : null}
                          published={row.status === "published"}
                        />
                        {expanded[row.key]
                          ? row.channels.map((v) => (
                            <div className="cm-mobile-variant" key={v.channel}>
                              <Channel value={v.channel} />
                              <Status value={v.status} />
                              <PublishDate row={row} channel={v} />
                              <span className="cm-muted">{contentStatusLabel(v.job_state || v.status)}</span>
                              <Performance
                            metricKeys={metricColumns}
                                channel={v}
                                published={v.status === "published"}
                              />
                            </div>
                          ))
                          : null}
                        {rowActions(row)}
                      </article>
                    )
                )}
              </div>
            </>
          )
          : null}
        {current && !bounds.error && view === "calendar"
          ? (
            <div
              className={`cm-calendar cm-calendar-${mode}`}
              aria-label={`${contentStatusLabel(mode)} content calendar`}
            >
              {mode === "month"
                ? Array.from(
                  {
                    length:
                      (new Date(`${range.days[0]}T12:00:00Z`).getUTCDay() + 6) %
                      7,
                  },
                  (_, i) => (
                    <div
                      className="cm-day cm-blank"
                      key={`blank:${i}`}
                      aria-hidden="true"
                    />
                  ),
                )
                : null}
              {range.days.map((day) => {
                const entries = rows.filter((row) => row.day === day);
                const count = state.summary.day_counts?.[day] || 0;
                return (
                  <section
                    className={`cm-day ${
                      day ===
                          localInput(new Date(), CONTENT_TIMEZONE).slice(0, 10)
                        ? "cm-today"
                        : ""
                    }`}
                    key={day}
                  >
                    <h2>
                      <time dateTime={day}>
                        {new Intl.DateTimeFormat("en-MY", {
                          timeZone: "UTC",
                          weekday: "short",
                          day: "numeric",
                        }).format(new Date(`${day}T12:00:00Z`))}
                      </time>
                      <span>{count || ""}</span>
                    </h2>
                    {entries.map((row) => (
                      <button
                        className={`cm-calendar-entry cm-status-${row.status}`}
                        key={row.key}
                        onClick={() => show(row)}
                      >
                        <Thumbnail channel={row.channels.find(v=>v.thumbnail_url || v.asset?.mime_type?.startsWith("image/")) || row.channels[0]} />
                        <span className="cm-calendar-copy">
                          <strong>{row.title}</strong>
                          <small>
                            {row.channels.map((v) => (
                              <Fragment key={v.channel}>
                                <Channel value={v.channel} />
                              </Fragment>
                            ))}
                          </small>
                          <Status value={row.status} />
                          {row.origin === "meta"
                            ? <small>External · Meta</small>
                            : null}
                        </span>
                      </button>
                    ))}
                    {count > entries.length
                      ? (
                        <button
                          className="cm-overflow"
                          onClick={() => {
                            setFrom(day);
                            setTo(day);
                            changeView("list");
                          }}
                        >
                          +{count - entries.length} more
                        </button>
                      )
                      : null}
                  </section>
                );
              })}
            </div>
          )
          : null}
      </AsyncDataSurface>
      {view === "list"
        ? (
          <AdminPagination
            {...state}
            loading={loading || busy}
            onPageChange={actions.requestPage}
            onPageSizeChange={actions.requestPageSize}
            noun="content records"
          />
        )
        : null}
      {external
        ? (
          <Modal title="Post details" placement="right" onClose={()=>setExternal(null)}>
            <PostDetail content={external}/>
          </Modal>
        )
        : null}
    </div>
  );
}
