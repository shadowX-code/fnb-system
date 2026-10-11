import {
  calendarRange,
  localInput,
  scheduleInstant,
} from "./marketingCalendar.js";
export const CONTENT_TIMEZONE = "Asia/Kuala_Lumpur";
export const contentStatusLabel = (status) =>
  status === "review"
    ? "Pending approval"
    : String(status || "").replace(/\b\w/g, (c) => c.toUpperCase());
export function preferredContentView(userId) {
  try {
    return localStorage.getItem(
        `admin.presentation.marketing.content.${userId}`,
      ) === "calendar"
      ? "calendar"
      : "list";
  } catch {
    return "list";
  }
}
export function saveContentView(userId, value) {
  try {
    localStorage.setItem(
      `admin.presentation.marketing.content.${userId}`,
      value,
    );
  } catch { /* Optional display preference. */ }
}
export function shiftContentPeriod(anchor, mode, direction) {
  const [year, month, day] = anchor.split("-").map(Number);
  const date = mode === "month"
    ? new Date(Date.UTC(year, month - 1 + direction, 1))
    : new Date(Date.UTC(year, month - 1, day + direction * 7));
  return date.toISOString().slice(0, 10);
}
export function contentBounds({ view, anchor, mode, from, to }) {
  const lower = from
    ? scheduleInstant(`${from}T00:00`, CONTENT_TIMEZONE)
    : null;
  const upper = to
    ? scheduleInstant(`${shiftDay(to, 1)}T00:00`, CONTENT_TIMEZONE)
    : null;
  if (lower && upper && lower >= upper) {
    throw new Error("End date must be on or after the start date.");
  }
  if (view === "list") return { from: lower, to: upper };
  const period = calendarRange(anchor, mode, CONTENT_TIMEZONE);
  const bounds = {
    from: lower && lower > period.from ? lower : period.from,
    to: upper && upper < period.to ? upper : period.to,
  };
  return { ...bounds, empty: bounds.from >= bounds.to };
}
export function shiftDay(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function contentMetric(channel, name) {
  const metrics = channel?.metrics || {};
  if (name === "engagement") {
    // Per-channel interactions only. Incomplete counts cannot be presented as a total.
    const keys = channel.channel === "facebook"
      ? ["likes", "comments", "shares"]
      : ["likes", "comments"];
    return keys.every((key) =>
        Number.isFinite(metrics[key]) && metrics[key] >= 0
      )
      ? keys.reduce((sum, key) => sum + metrics[key], 0)
      : null;
  }
  return Number.isFinite(metrics[name]) && metrics[name] >= 0
    ? metrics[name]
    : null;
}
export function contentDay(value) {
  return localInput(new Date(value), CONTENT_TIMEZONE).slice(0, 10);
}

export const POST_METRICS = [
 {key:'reach',label:'Reach',description:'Instagram estimated unique accounts reached. Facebook legacy Reach is unavailable.'},
 {key:'views',label:'Views',description:'Instagram organic views; Facebook times content was played or displayed. Definitions differ by platform.'},
 {key:'interactions',label:'Interactions',description:'Instagram reported organic likes, comments, saves and shares. Facebook recorded reactions + comments + shares, only when all counts exist.'},
 {key:'likes',label:'Likes',description:'Recorded likes; not all Facebook reactions.'},
 {key:'reactions',label:'Reactions',description:'Facebook reactions across types.'},
 {key:'comments',label:'Comments',description:'Recorded comment count.'},
 {key:'shares',label:'Shares',description:'Platform-reported shares.'},
 {key:'saves',label:'Saves',description:'Instagram saves; unavailable on Facebook.'},
 {key:'viewers',label:'Unique viewers',description:'Facebook unique media viewers. Not interchangeable with legacy Reach.'},
 {key:'watch_time_ms',label:'Total watch time',unit:'ms',description:'Instagram Reels watch time including replays, in milliseconds.'},
 {key:'avg_watch_time_ms',label:'Average watch time',unit:'ms',description:'Instagram Reels average watch time, in milliseconds.'},
];
export function postMetric(channel, key) {
 if(key==='interactions' && channel?.channel==='facebook') {
  const m=channel.metrics||{};return ['reactions','comments','shares'].every(k=>Number.isFinite(m[k])&&m[k]>=0)?m.reactions+m.comments+m.shares:null;
 }
 return contentMetric(channel,key);
}
export function metricReason(channel,key) {
 if(postMetric(channel,key)!==null)return '';
 const reason=channel?.unavailable_metrics?.[key];
 if(reason?.includes('permission'))return 'Permission required';
 if(reason==='unsupported_media_type'||reason==='not_supported')return 'Not supported for this post';
 if(key==='interactions'&&channel?.channel==='facebook')return 'Complete reaction, comment and share counts unavailable';
 return 'Not available from Meta';
}
export function safePostMediaUrl(value) {
 try {const u=new URL(value);return u.protocol==='https:' && /(^|\.)(fbcdn\.net|cdninstagram\.com)$/.test(u.hostname)&& !/(access_token|authorization|appsecret)/i.test(value)?value:null;}catch{return null;}
}
export function safePostLink(value) {
 try {const u=new URL(value);return u.protocol==='https:' && /(^|\.)(facebook\.com|instagram\.com)$/.test(u.hostname)?value:null;}catch{return null;}
}
export function preferredMetricColumns(userId) {
 try {const saved=JSON.parse(localStorage.getItem(`admin.presentation.marketing.metrics.${userId}`));if(Array.isArray(saved)&&saved.every(k=>POST_METRICS.some(m=>m.key===k)))return saved;}catch{}return ['reach','views','interactions','likes','comments','shares'];
}
export function saveMetricColumns(userId,columns) {
 try{localStorage.setItem(`admin.presentation.marketing.metrics.${userId}`,JSON.stringify(columns));}catch{}
}
