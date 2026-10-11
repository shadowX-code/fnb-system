import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import {
  STAGING_SUPABASE,
  STAGING_ORIGIN,
  authorizationUrl,
  nonce,
  hash,
  seal,
  unseal,
  connectionBinding,
} from "../_shared/metaSecurity.ts";
import { MetaGraph, MetaError } from "../_shared/metaGraph.ts";
import { verifyAdsAccount, readAdsReport } from "../_shared/metaAds.ts";
const env = (n: string) => Deno.env.get(n) || "";
Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "",
    allowed = new Set([STAGING_ORIGIN, "http://localhost:5173"]);
  const headers = {
    "Access-Control-Allow-Origin": allowed.has(origin)
      ? origin
      : STAGING_ORIGIN,
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  const reply = (value: any, status = 200) =>
    new Response(JSON.stringify(value), { status, headers });
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (
    env("SUPABASE_URL") !== STAGING_SUPABASE ||
    req.method !== "POST" ||
    (origin && !allowed.has(origin))
  )
    return reply({ error: "Endpoint unavailable." }, 403);
  const bearer = req.headers.get("authorization") || "";
  if (!bearer.startsWith("Bearer "))
    return reply({ error: "Sign in to Marketing." }, 401);
  const caller = createClient(STAGING_SUPABASE, env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: bearer } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: identity, error: identityError } = await caller.auth.getUser();
  if (identityError || !identity.user)
    return reply({ error: "Sign in to Marketing." }, 401);
  const service = createClient(
    STAGING_SUPABASE,
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const call = async (db: any, name: string, args: any) => {
    const { data, error } = await db.rpc(name, args);
    if (error)
      throw new MetaError(
        error.code === "42501" ? "scope_denied" : "ads_request_rejected",
      );
    return data;
  };
  try {
    const raw = await req.text();
    if (raw.length > 10000) return reply({ error: "Request too large." }, 413);
    const body = JSON.parse(raw);
    const path = new URL(req.url).pathname.split("/marketing-ads")[1];
    if (!["/authorize", "/bind", "/preview"].includes(path))
      return reply({ error: "Endpoint unavailable." }, 404);
    const config = {
        appId: env("MARKETING_META_APP_ID"),
        appSecret: env("MARKETING_META_APP_SECRET"),
        configId: env("MARKETING_META_LOGIN_CONFIG_ID"),
        version: env("MARKETING_META_GRAPH_VERSION"),
      },
      key = env("MARKETING_META_TOKEN_ENCRYPTION_KEY");
    if (!Object.values(config).every(Boolean) || !key)
      return reply(
        { error: "Meta connection configuration is unavailable." },
        503,
      );
    if (path === "/authorize") {
      const state = nonce();
      await call(caller, "marketing_ads_begin", {
        p_org: body.organizationId,
        p_brand: body.brandId,
        p_state_hash: await hash(state),
      });
      return reply({
        authorization_url: authorizationUrl(config, state),
        execution_enabled: false,
      });
    }
    const session = await call(
      service,
      path === "/preview"
        ? "marketing_ads_preview_session"
        : "marketing_ads_session",
      {
        p_session: body.sessionId,
        p_auth_user: identity.user.id,
      },
    );
    if (path === "/preview") {
      if (
        !session.accounts.some((a: any) => a.id === body.accountId) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(body.from) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(body.to)
      )
        throw new MetaError("ads_request_rejected");
      const span = Date.parse(body.to) - Date.parse(body.from);
      if (!Number.isFinite(span) || span < 0 || span > 93 * 86400000)
        throw new MetaError("ads_request_rejected");
      const grant = await unseal(
        session.sealed_discovery,
        [key, env("MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY")],
        `oauth:${session.id}`,
      );
      const graph = new MetaGraph(config);
      const account = await verifyAdsAccount(
        graph,
        config.appId,
        config.appSecret,
        grant.token,
        body.accountId,
        grant.userId,
      );
      const deadline = Date.now() + 85000;
      const guard = async () => {
        if (Date.now() > deadline || Date.parse(grant.expiresAt) <= Date.now())
          throw new MetaError("ads_sync_time_limit");
        await call(service, "marketing_ads_preview_session", {
          p_session: session.id,
          p_auth_user: identity.user.id,
        });
      };
      const report = await readAdsReport(
        graph,
        account,
        grant.token,
        body.from,
        body.to,
        guard,
      );
      await call(service, "marketing_ads_preview_finish", {
        p_session: session.id,
        p_auth_user: identity.user.id,
        p_account: account.id,
        p_report: report,
      });
      return reply({ report, execution_enabled: false, bound: false });
    }
    if (
      body.confirmOwnership !== true ||
      body.brandId != null ||
      !session.accounts.some((a: any) => a.id === body.accountId)
    )
      return reply(
        { error: "Confirm the discovered account and organization ownership." },
        409,
      );
    const discovery = await unseal(
      session.sealed_discovery,
      [key, env("MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY")],
      `oauth:${session.id}`,
    );
    if (Date.parse(discovery.expiresAt) <= Date.now())
      return reply({ error: "Account selection expired." }, 409);
    const graph = new MetaGraph(config),
      account = await verifyAdsAccount(
        graph,
        config.appId,
        config.appSecret,
        discovery.token,
        body.accountId,
        discovery.userId,
      );
    const sealed = await seal(
      { token: discovery.token },
      key,
      connectionBinding({
        organization_id: session.organization_id,
        brand_id: null,
        channel: "ad_account",
        provider_account_id: account.id,
      }),
    );
    const result = await call(service, "marketing_ads_bind", {
      p_session: session.id,
      p_auth_user: identity.user.id,
      p_account: account.id,
      p_brand: null,
      p_sealed: sealed,
      p_expiry: discovery.expiresAt,
      p_account_evidence: account,
      p_expected_generation: body.expectedGeneration ?? null,
    });
    return reply({
      connection: result,
      health: account,
      execution_enabled: false,
    });
  } catch (e) {
    const code = e instanceof MetaError ? e.code : "ads_request_rejected";
    const messages: Record<string, string> = {
      ads_read_not_granted:
        "Ad reporting permission is unavailable. Existing Page access does not grant Ad Account access.",
      ad_account_access_unverified:
        "Meta did not authorize this Ad Account for the connection owner.",
      scope_denied:
        "Your role or brand access changed. Ask a Marketing administrator.",
      meta_permission_or_token_invalid:
        "Meta authorization expired or does not permit this operation.",
      ads_request_rejected:
        "Account selection changed or is no longer available. Refresh the page.",
    };
    return reply(
      {
        error: messages[code] || "Ad Account connection could not be verified.",
        code,
      },
      409,
    );
  }
});
