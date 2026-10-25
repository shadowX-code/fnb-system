import { MetaError, MetaGraph } from "./metaGraph.ts";
import { adsPages, verifyAdsAccount } from "./metaAds.ts";

export function adsManagementLoginConfig(env: (key: string) => string, shared: string) {
  const id = env("MARKETING_ADS_MANAGEMENT_LOGIN_CONFIG_ID");
  return /^\d{1,30}$/.test(id) && id !== shared ? id : null;
}

// Production permits only a single, already-approved paused creation revision.
export function adsExecutionAllowed(env: (key: string) => string, change: any, production: boolean, now = Date.now()) {
  if (env("MARKETING_ADS_EXECUTION_ENABLED") !== "true" || !change?.fingerprint ||
    !env("MARKETING_ADS_EXECUTION_APPROVALS").split(",").includes(change.fingerprint)) return false;
  if (!production) return true;
  return change.operation === "create" && change.configuration?.create_contract_version === 3 &&
    !change.configuration.recovery_source && Number(change.maximum_budget) > 0 &&
    Number.isFinite(Date.parse(change.paused_create_expires_at)) && Date.parse(change.paused_create_expires_at) > now &&
    Date.parse(change.paused_create_expires_at) <= now + 30 * 60 * 1000;
}

export async function adsReadOnlyPreflight(graph: MetaGraph, token: string, appId: string, appSecret: string, material: any, guard: () => Promise<void>) {
  const c = material.connection;
  const health = await verifyAdsAccount(graph, appId, appSecret, token, c.provider_account_id, c.meta_user_id, guard);
  const blockers: string[] = [];
  if (!health.manage_verified) blockers.push(health.manage_reason || "ads_management_required");
  const checks: Record<string, any> = { account: { id: health.id, currency: health.currency, timezone: health.timezone, account_status: health.account_status, management_verified: health.manage_verified } };
  const inspect = async (key: string, read: () => Promise<any>) => {
    try { await guard(); checks[key] = await read(); }
    catch (e) { checks[key] = { status: "unavailable", reason: e instanceof MetaError ? e.code : "provider_read_failed" }; blockers.push(`${key}_unavailable`); }
  };
  await inspect("page", async () => {
    const pages = await adsPages(graph, "me/accounts", token, { fields: "id,tasks" }, guard);
    const page = pages.find((p: any) => p.id === material.page.provider_account_id);
    const verified = page?.tasks?.some((t: string) => ["ADVERTISE", "MANAGE", "PROFILE_PLUS_ADVERTISE", "PROFILE_PLUS_FULL_CONTROL"].includes(t)) === true;
    if (!verified) blockers.push("ad_page_authorization_unverified");
    return { id: material.page.provider_account_id, generation: material.page.credential_generation, advertising_verified: verified };
  });
  await inspect("minimum_budget", async () => {
    const result = await graph.request(`act_${c.provider_account_id}/minimum_budgets`, token, { fields: "currency,min_daily_budget_imp", limit: 25 });
    const rows = Array.isArray(result.data) ? result.data.filter((r: any) => r.currency === health.currency) : [];
    if (result.paging?.next || rows.length !== 1 || !Number.isSafeInteger(Number(rows[0].min_daily_budget_imp)) || Number(rows[0].min_daily_budget_imp) <= 0)
      throw new MetaError("minimum_budget_unavailable");
    return { currency: health.currency, impressions_daily_minor: Number(rows[0].min_daily_budget_imp), exact_lifetime_budget_validated: false };
  });
  if (material.source_post) await inspect("post", async () => {
    const source = material.source_post;
    const p = await graph.request(source.provider_post_id, token, { fields: "id,from{id},message,is_published,is_eligible_for_promotion,allowed_advertising_objectives,attachments{media_type}" });
    const media = p.attachments?.data || [];
    const eligible = p.id === source.provider_post_id && p.from?.id === material.page.provider_account_id && p.is_published === true &&
      p.is_eligible_for_promotion === true && Array.isArray(p.allowed_advertising_objectives) && p.allowed_advertising_objectives.includes("OUTCOME_AWARENESS") &&
      (p.message || "") === source.caption && (source.format === "image" ? media.length === 1 && media[0].media_type === "photo" : media.length === 0);
    if (!eligible) blockers.push("ad_source_post_unverified");
    return { id: source.provider_post_id, eligible, objective: "OUTCOME_AWARENESS", placement: "facebook_feed" };
  });
  else checks.post = { status: "not_requested", eligible: null };
  await guard();
  return { generation: c.credential_generation, checks, blockers: [...new Set([...blockers, "advertiser_payer_verification_required"])],
    declarations: { status: "unverified", provider_verified: false, message: "Verify the actual advertiser and payer in Meta, then provide their verified identity IDs. Numeric draft IDs and FeedX approval are not verification." },
    creation_authorized: false, activation_authorized: false, delivery_verified: false };
}
