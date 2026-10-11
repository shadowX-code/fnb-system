// Bounded Ads-only error evidence. Never retain raw bodies, headers or request values.
export type AdsErrorEvidence = {
  endpoint: string;
  method: string;
  graph_version: string;
  http_status: number;
  code: number | null;
  error_subcode: number | null;
  fbtrace_id: string | null;
  error_user_title: string | null;
  error_user_msg: string | null;
  message: string | null;
  is_transient: boolean | null;
  blame_field_specs: string[][];
};
const fields = new Set([
  "name",
  "campaign_id",
  "adset_id",
  "status",
  "objective",
  "buying_type",
  "bid_strategy",
  "bid_amount",
  "billing_event",
  "optimization_goal",
  "destination_type",
  "start_time",
  "end_time",
  "stop_time",
  "daily_budget",
  "lifetime_budget",
  "targeting",
  "geo_locations",
  "countries",
  "age_min",
  "age_max",
  "publisher_platforms",
  "facebook_positions",
  "instagram_positions",
  "targeting_automation",
  "advantage_audience",
  "promoted_object",
  "page_id",
  "instagram_user_id",
  "special_ad_categories",
  "regional_regulated_categories",
  "regional_regulation_identities",
  "universal_beneficiary",
  "universal_payer",
  "creative",
  "creative_id",
  "object_story_spec",
  "link_data",
  "image_hash",
  "link",
  "message",
  "call_to_action",
  "type",
  "value",
  "execution_options",
  "is_adset_budget_sharing_enabled",
]);
export function adsErrorEvidence(
  path: string,
  method: string,
  version: string,
  status: number,
  error: any,
  secrets: string[],
  params: Record<string, any>,
): AdsErrorEvidence | undefined {
  if (
    !/^act_\d{1,30}\/(?:adsets|campaigns|adcreatives|adimages|ads)$/.test(
      path,
    ) ||
    method !== "POST"
  )
    return;
  const sensitive = new Set(secrets.filter(Boolean));
  const collect = (v: any, depth = 0) => {
    if (depth > 8) return;
    if (typeof v === "string" && v.length >= 4 && v.length <= 8192) {
      sensitive.add(v);
      const baseName = v.split(" · ")[0];
      if (baseName.length >= 4) sensitive.add(baseName);
    } else if (Array.isArray(v))
      v.slice(0, 50).forEach((x) => collect(x, depth + 1));
    else if (v && typeof v === "object")
      Object.values(v)
        .slice(0, 50)
        .forEach((x) => collect(x, depth + 1));
  };
  collect(params);
  const text = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    // Reject oversized text before redaction so truncation cannot leave partial credentials.
    if (v.length > 4096) return "[omitted: oversized provider text]";
    let result = v;
    for (const s of [...sensitive].sort((a, b) => b.length - a.length))
      for (const encoded of new Set([s, encodeURIComponent(s)]))
        result = result.split(encoded).join("[redacted]");
    return result
      .replace(/Bearer\s+\S+/gi, "[redacted]")
      .replace(/\bEAA[A-Za-z0-9_-]+/g, "[redacted]")
      .replace(/https?:\/\/[^\s<>]+/gi, "[redacted URL]")
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[redacted email]")
      .replace(/\+?\d[\d ()-]{6,}\d/g, "[redacted number]")
      .replace(/<[^>]*>|[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
      .slice(0, 1000);
  };
  const integer = (v: unknown) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
  const trace =
    typeof error?.fbtrace_id === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(error.fbtrace_id) &&
    ![...sensitive].some((s) => error.fbtrace_id.includes(s))
      ? error.fbtrace_id
      : null;
  const blame = Array.isArray(error?.error_data?.blame_field_specs)
    ? error.error_data.blame_field_specs
    : [];
  return {
    endpoint: path,
    method,
    graph_version: version,
    http_status: status,
    code: integer(error?.code),
    error_subcode: integer(error?.error_subcode),
    fbtrace_id: trace,
    error_user_title: text(error?.error_user_title),
    error_user_msg: text(error?.error_user_msg),
    message: text(error?.message),
    is_transient:
      typeof error?.is_transient === "boolean" ? error.is_transient : null,
    blame_field_specs: blame
      .slice(0, 10)
      .filter(
        (p: any) =>
          Array.isArray(p) &&
          p.length > 0 &&
          p.length <= 6 &&
          p.every((k: any) => typeof k === "string" && fields.has(k)),
      ),
  };
}
