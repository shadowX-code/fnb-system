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
