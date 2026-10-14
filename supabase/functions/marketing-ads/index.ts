import {runtimeMetaMatches, PRODUCTION_RUNTIME} from '../_shared/marketingEnvironment.mjs';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import {
  RUNTIME_SUPABASE,
  RUNTIME_ORIGIN,
  authorizationUrl,
  nonce,
  hash,
  seal,
  unseal,
  connectionBinding,
} from "../_shared/metaSecurity.ts";
import { MetaGraph, MetaError } from "../_shared/metaGraph.ts";
import { verifyAdsAccount, readAdsReport } from "../_shared/metaAds.ts";
import { bytesHash, executeAdsChange } from "../_shared/metaAdsManagement.ts";
import { validatePausedAdSet } from "../_shared/metaAdsValidation.ts";
import { requestAdsAI, estimateAdsAICost } from "../_shared/marketingAdsAI.ts";
const env = (n: string) => Deno.env.get(n) || "";
Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "",
    allowed = new Set(PRODUCTION_RUNTIME ? [RUNTIME_ORIGIN] : [RUNTIME_ORIGIN, "http://localhost:5173"]);
  const headers = {
    "Access-Control-Allow-Origin": allowed.has(origin)
      ? origin
      : RUNTIME_ORIGIN,
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
    !runtimeMetaMatches(env) || !RUNTIME_SUPABASE || env("SUPABASE_URL") !== RUNTIME_SUPABASE ||
    req.method !== "POST" ||
    (origin && !allowed.has(origin))
  )
    return reply({ error: "Endpoint unavailable." }, 403);
  const bearer = req.headers.get("authorization") || "";
  if (!bearer.startsWith("Bearer "))
    return reply({ error: "Sign in to Marketing." }, 401);
  const caller = createClient(RUNTIME_SUPABASE, env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: bearer } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: identity, error: identityError } = await caller.auth.getUser();
  if (identityError || !identity.user)
    return reply({ error: "Sign in to Marketing." }, 401);
  const service = createClient(
    RUNTIME_SUPABASE,
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
    if (
      ![
        "/authorize",
        "/bind",
        "/preview",
        "/copilot",
        "/capabilities",
        "/prepare-change",
        "/execute-change",
        "/reconcile-change",
        "/validate-adset",
      ].includes(path)
    )
      return reply({ error: "Endpoint unavailable." }, 404);
    if (path === "/capabilities")
      return reply({
        ai_available:
          !PRODUCTION_RUNTIME && env("MARKETING_ADS_AI_ENABLED") === "true" &&
          Boolean(env("OPENAI_API_KEY") && env("MARKETING_AI_MODEL")),
        external_execution_enabled:
          !PRODUCTION_RUNTIME && env("MARKETING_ADS_EXECUTION_ENABLED") === "true",
      });
    if (path === "/validate-adset") {
      const args = {
        p_request: body.requestId,
        p_auth_user: identity.user.id,
        p_fingerprint: body.fingerprint,
      };
      const material = await call(
        service,
        "marketing_ads_validation_material",
        args,
      );
      const c = material.connection;
      const grant = await unseal(
        c.sealed_token,
        [
          env("MARKETING_META_TOKEN_ENCRYPTION_KEY"),
          env("MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY"),
        ],
        connectionBinding(c),
      );
      const graph = new MetaGraph({
        appId: env("MARKETING_META_APP_ID"),
        appSecret: env("MARKETING_META_APP_SECRET"),
        configId: env("MARKETING_META_LOGIN_CONFIG_ID"),
        version: env("MARKETING_META_GRAPH_VERSION"),
      });
      const guard = async () => {
        await call(service, "marketing_ads_validation_material", args);
      };
      const health = await verifyAdsAccount(
        graph,
        env("MARKETING_META_APP_ID"),
        env("MARKETING_META_APP_SECRET"),
        grant.token,
        c.provider_account_id,
        c.meta_user_id,
        guard,
      );
      if (
        !health.manage_verified ||
        health.currency !== material.change.currency ||
        health.timezone !== material.change.timezone
      )
        throw new MetaError("ad_account_authorization_changed");
      const result = await validatePausedAdSet(
        graph,
        grant.token,
        material.change,
        guard,
      );
      await call(service, "marketing_ads_validation_record", {
        ...args,
        p_evidence: result,
      });
      return reply(result);
    }
    if (path === "/prepare-change") {
      const visible = await call(caller, "marketing_ads_changes_read", {
        p_org: body.organizationId,
        p_brand: body.brandId,
      });
      let mediaHash: string | null = null;
      if (body.operation === "create") {
        const asset = visible.assets.find(
          (a: any) =>
            a.id === body.configuration?.asset_id &&
            a.brand_id === body.brandId,
        );
        if (!asset) throw new MetaError("ad_media_unavailable");
        const { data, error } = await service.storage
          .from("marketing-media")
          .download(asset.object_path);
        if (error || !data || data.size !== Number(asset.size_bytes))
          throw new MetaError("ad_media_unavailable");
        mediaHash = await bytesHash(new Uint8Array(await data.arrayBuffer()));
      }
      return reply(
        await call(service, "marketing_ads_change_prepare", {
          p_request: body.requestId,
          p_auth_user: identity.user.id,
          p_org: body.organizationId,
          p_brand: body.brandId,
          p_connection: body.connectionId,
          p_operation: body.operation,
          p_config: body.configuration,
          p_media_hash: mediaHash,
          p_previous: body.previousId || null,
        }),
      );
    }
    if (path === "/reconcile-change") {
      const claim = await call(
        service,
        "marketing_ads_change_reconcile_claim",
        { p_request: body.requestId, p_auth_user: identity.user.id },
      );
      const graph = new MetaGraph({
        appId: env("MARKETING_META_APP_ID"),
        appSecret: env("MARKETING_META_APP_SECRET"),
        configId: env("MARKETING_META_LOGIN_CONFIG_ID"),
        version: env("MARKETING_META_GRAPH_VERSION"),
      });
      return reply({
        state: await executeAdsChange(service, graph, env, claim),
      });
    }
    if (path === "/execute-change") {
      if (
        PRODUCTION_RUNTIME || env("MARKETING_ADS_EXECUTION_ENABLED") !== "true" ||
        !body.fingerprint ||
        !env("MARKETING_ADS_EXECUTION_APPROVALS")
          .split(",")
          .includes(body.fingerprint)
      )
        return reply(
          {
            error:
              "External advertising execution is disabled. This exact revision requires separate authorization.",
          },
          403,
        );
      const claim = await call(service, "marketing_ads_change_claim", {
        p_request: body.requestId,
        p_auth_user: identity.user.id,
        p_fingerprint: body.fingerprint,
      });
      if (!claim) return reply({ state: "already_claimed" });
      const graph = new MetaGraph({
        appId: env("MARKETING_META_APP_ID"),
        appSecret: env("MARKETING_META_APP_SECRET"),
        configId: env("MARKETING_META_LOGIN_CONFIG_ID"),
        version: env("MARKETING_META_GRAPH_VERSION"),
      });
      return reply({
        state: await executeAdsChange(service, graph, env, claim),
      });
    }
    if (path === "/copilot") {
      if (
        PRODUCTION_RUNTIME || env("MARKETING_ADS_AI_ENABLED") !== "true" ||
        !env("OPENAI_API_KEY") ||
        !env("MARKETING_AI_MODEL")
      )
        return reply(
          { error: "Ads AI provider is not enabled. Ask your administrator." },
          503,
        );
      let claim: any;
      let observedUsage: any;
      const rates = [
        "MARKETING_ADS_AI_INPUT_USD_PER_M",
        "MARKETING_ADS_AI_CACHED_USD_PER_M",
        "MARKETING_ADS_AI_OUTPUT_USD_PER_M",
      ].map((n) => env(n));
      const costBasis =
        "Estimated USD using configured per-million input/cached/output rates; not invoiced cost.";
      try {
        const prepared = await call(caller, "marketing_ads_ai_prepare", {
          p_request: body.requestId,
          p_org: body.organizationId,
          p_brand: body.brandId,
          p_connection: body.connectionId,
          p_from: body.from,
          p_to: body.to,
        });
        if (prepared.state !== "prepared") return reply(prepared);
        claim = await call(service, "marketing_ads_ai_claim", {
          p_request: body.requestId,
          p_auth_user: identity.user.id,
        });
        if (!claim) return reply({ state: "already_generating" });
        const result = await requestAdsAI(
          claim.evidence,
          env("OPENAI_API_KEY"),
          env("MARKETING_AI_MODEL"),
        );
        observedUsage = result;
        const cost = estimateAdsAICost(result, rates);
        return reply(
          await call(service, "marketing_ads_ai_finish", {
            p_request: body.requestId,
            p_lease: claim.lease,
            p_proposal: result.body,
            p_model: result.model,
            p_input: result.input,
            p_output: result.output,
            p_cost: cost,
            p_cost_basis: cost == null ? null : costBasis,
            p_error: false,
          }),
        );
      } catch (error) {
        const reason = [
          "ai_shape_invalid",
          "ai_evidence_invalid",
          "ai_provider_incomplete",
          "ai_provider_failed",
          "ai_not_configured",
          "ads_performance_required",
        ].includes((error as any)?.message)
          ? (error as any).message
          : "ads_request_rejected";
        console.warn("marketing_ads_copilot_rejected", { reason });
        const usage = observedUsage || (error as any)?.usage;
        if (claim)
          try {
            await call(service, "marketing_ads_ai_finish", {
              p_request: body.requestId,
              p_lease: claim.lease,
              p_proposal: null,
              p_model: usage?.model || env("MARKETING_AI_MODEL"),
              p_input: usage?.input ?? null,
              p_output: usage?.output ?? null,
              p_cost: estimateAdsAICost(usage, rates),
              p_cost_basis:
                estimateAdsAICost(usage, rates) == null ? null : costBasis,
              p_error: true,
            });
          } catch {}
        return reply(
          {
            error:
              "Recommendations could not be generated. Check synchronized brand performance, AI access and provider availability. No advertising was changed.",
          },
          409,
        );
      }
    }
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
    if(path==='/bind'&&session.selected_at){
      if(body.confirmOwnership!==true||body.brandId!=null)throw new MetaError('ads_request_rejected');
      const connection=await call(service,'marketing_ads_bind',{p_session:session.id,p_auth_user:identity.user.id,p_account:body.accountId,p_brand:null,p_sealed:null,p_expiry:null,p_account_evidence:null,p_expected_generation:body.expectedGeneration??null});
      return reply({connection,already_confirmed:true,execution_enabled:false});
    }
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
        "This advertising configuration is unavailable or changed. Check brand ownership, supported settings and the current revision.",
      ad_media_unavailable:
        "Choose an available image from this brand’s Content Library.",
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
