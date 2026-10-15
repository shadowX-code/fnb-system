export const adsMetricNames = {
  spend: "Spend",
  reach: "Reach",
  impressions: "Impressions",
  clicks: "Clicks",
  ctr: "CTR",
  cpc: "CPC",
  cpm: "CPM",
};
export function adsMetric(metric, key, currency = "") {
  if (metric?.value === null || metric?.value === undefined) return "—";
  const number = new Intl.NumberFormat("en-MY", {
    maximumFractionDigits: ["ctr", "cpc", "cpm", "spend"].includes(key) ? 2 : 0,
  }).format(metric.value);
  return `${["spend", "cpc", "cpm"].includes(key) ? `${currency} ` : ""}${number}${key === "ctr" ? "%" : ""}`;
}
export function precedingPeriod(from, to) {
  const start = new Date(`${from}T00:00:00Z`),
    end = new Date(`${to}T00:00:00Z`);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end < start ||
    end - start > 93 * 86400000
  )
    return null;
  const days = Math.round((end - start) / 86400000) + 1;
  return {
    from: new Date(start - days * 86400000).toISOString().slice(0, 10),
    to: new Date(start - 86400000).toISOString().slice(0, 10),
  };
}
export function insightFor(report, level, id) {
  return (
    report?.insights?.[level]?.find((row) => row[`${level}_id`] === id) || null
  );
}
export function metricComparison(current, previous) {
  if (current?.value == null || previous?.value == null) return null;
  if (previous.value === 0)
    return current.value === 0 ? "No change" : "No comparable baseline";
  const value = ((current.value - previous.value) / previous.value) * 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
export function adsManagerUrl(account, id, level = "campaign") {
  if (!/^\d+$/.test(String(account))) return null;
  const url = new URL(
    "https://adsmanager.facebook.com/adsmanager/manage/" +
      (level === "adset" ? "adsets" : level === "ad" ? "ads" : "campaigns"),
  );
  url.searchParams.set("act", account);
  if (id && /^\d+$/.test(String(id)))
    url.searchParams.set(
      "selected_" +
        (level === "adset" ? "adset" : level === "ad" ? "ad" : "campaign") +
        "_ids",
      id,
    );
  return url.toString();
}

// Unknown coverage is visible; no residual account subtraction and no summed reach.
export function attributionSpend(report) {
  return report?.scope === "organization"
    ? report.insights?.attribution_spend || []
    : [];
}
export const adsMetricDefinitions = {
  spend: "Meta-reported spend in the account currency.",
  reach: "Estimated people reached; not additive across campaigns or brands.",
  impressions: "Number of times ads were shown.",
  clicks: "All ad clicks, not link clicks alone.",
  ctr: "All clicks divided by impressions × 100.",
  cpc: "Spend divided by all clicks.",
  cpm: "Spend per 1,000 impressions.",
};

// Labels retain exact Meta action identity; no category totals or inferred sales.
export const adsResultLabels = {
  link_click: 'Link clicks',
  'onsite_conversion.messaging_conversation_started_7d': 'Messaging conversations started · 7-day',
  'onsite_conversion.messaging_first_reply': 'First messaging replies',
  post_engagement: 'Post engagements',
  post_reaction: 'Post reactions',
  comment: 'Comments',
  post: 'Post shares',
  video_view: 'Video views',
  lead: 'Leads · Meta attributed',
  omni_purchase: 'Purchases · Meta attributed',
  purchase: 'Purchases · Meta purchase action',
};
export const adsResultGroups = [
  {label: 'Traffic', types: ['link_click']},
  {label: 'Conversations', types: ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.messaging_first_reply']},
  {label: 'Engagement', types: ['video_view', 'post_reaction', 'comment', 'post']},
  {label: 'Conversions · Meta attributed', types: ['lead', 'omni_purchase', 'purchase']},
];
export const adsResultLabel = type => adsResultLabels[type] || type.replaceAll('_', ' ');
export function campaignResult(row, config, selectedType = '') {
  const objective = config?.objective || '';
  const candidates = /TRAFFIC|LINK_CLICKS/.test(objective) ? ['link_click']
    : /SALES|CONVERSIONS/.test(objective) ? ['omni_purchase', 'purchase']
    : /LEAD/.test(objective) ? ['lead']
    : /MESSAGES/.test(objective) ? ['onsite_conversion.messaging_conversation_started_7d']
    : /VIDEO/.test(objective) ? ['video_view']
    : /ENGAGEMENT/.test(objective) ? ['onsite_conversion.messaging_conversation_started_7d', 'post_engagement']
    : [];
  const type = selectedType || candidates.find(type => row?.actions?.some(a => a.type === type));
  return type ? {type, label: adsResultLabel(type), value: row?.actions?.find(a => a.type === type)?.value ?? null, cost: row?.cost_per_action_type?.find(a => a.type === type)?.value ?? null} : null;
}
export function adsDailySpend(report) {
  if (!report?.date_from || !report?.date_to) return [];
  const byDate = new Map((report.insights?.daily || []).map(r => [r.date_start, r.metrics?.spend?.value ?? null]));
  const rows = [];
  for (let day = Date.parse(report.date_from + 'T00:00:00Z'), end = Date.parse(report.date_to + 'T00:00:00Z'); day <= end && rows.length < 94; day += 86400000) {
    const date = new Date(day).toISOString().slice(0, 10);
    rows.push({date, spend: byDate.get(date) ?? null});
  }
  return rows;
}
