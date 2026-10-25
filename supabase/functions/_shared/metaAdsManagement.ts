import { MetaError, MetaGraph } from "./metaGraph.ts";
import { adsPages, verifyAdsAccount, ADS_CONFIG_FIELDS } from "./metaAds.ts";
import { connectionBinding, unseal } from "./metaSecurity.ts";
import { verifyMetaMedia } from "./metaPublishing.ts";
const numericId = (v: unknown) => typeof v === "string" && /^\d{1,30}$/.test(v);
export async function bytesHash(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function canonical(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export async function campaignTree(
  graph: MetaGraph,
  token: string,
  account: string,
  campaign: string,
  guard: () => Promise<void>,
) {
  const configs: any = {};
  for (const [edge, fields] of Object.entries(ADS_CONFIG_FIELDS))
    configs[edge] = await adsPages(
      graph,
      `act_${account}/${edge}`,
      token,
      { fields },
      guard,
    );
  return {
    campaign: configs.campaigns.find((r: any) => r.id === campaign) || null,
    adsets: configs.adsets
      .filter((r: any) => r.campaign_id === campaign)
      .sort((a: any, b: any) => a.id.localeCompare(b.id)),
    ads: configs.ads
      .filter((r: any) => r.campaign_id === campaign)
      .sort((a: any, b: any) => a.id.localeCompare(b.id)),
  };
}
export function matchingLocalAudience(actual:any,expected:any) {
  if(!actual || actual.countries?.length || actual.regions?.length || actual.zips?.length || actual.country_groups?.length) return false;
  if(expected.type==="city") {
    const rows=actual.cities;
    return !actual.custom_locations?.length && rows?.length===1 && rows[0].key===expected.key && Number(rows[0].radius)===expected.radius && rows[0].distance_unit==="kilometer";
  }
  const rows=actual.custom_locations;
  return !actual.cities?.length && rows?.length===1 && Number(rows[0].latitude)===expected.latitude && Number(rows[0].longitude)===expected.longitude && Number(rows[0].radius)===expected.radius && rows[0].distance_unit==="kilometer";
}
export function createPayloads(change: any, ids: any) {
  const c = change.configuration;
  const targeting: any = {
    geo_locations: c.create_contract_version === 3
      ? c.audience.type === "city"
        ? { cities: [{key:c.audience.key,radius:c.audience.radius,distance_unit:"kilometer"}] }
        : { custom_locations: [{latitude:c.audience.latitude,longitude:c.audience.longitude,radius:c.audience.radius,distance_unit:"kilometer",country:"MY"}] }
      : { countries: ["MY"] },
    age_min: Number(c.age_min),
    age_max: Number(c.age_max),
    publisher_platforms:
      c.placements === "both_feeds"
        ? ["facebook", "instagram"]
        : [c.placements === "facebook_feed" ? "facebook" : "instagram"],
  };
  if (c.placements !== "instagram_feed")
    targeting.facebook_positions = ["feed"];
  if (c.placements !== "facebook_feed")
    targeting.instagram_positions = ["stream"];
  return {
    campaign: {
      name: c.name,
      objective: c.objective,
      buying_type: "AUCTION",
      start_time: c.start_time,
      stop_time: c.end_time,
      special_ad_categories: [],
      status: "PAUSED",
      lifetime_budget: String(change.maximum_budget),
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    },
    adset: {
      name: `${c.name} · Audience`,
      campaign_id: ids.campaign_id,
      status: "PAUSED",
      start_time: c.start_time,
      end_time: c.end_time,
      billing_event: "IMPRESSIONS",
      optimization_goal:
        c.objective === "OUTCOME_TRAFFIC" ? "LINK_CLICKS" : "IMPRESSIONS",
      targeting,
      ...(c.adset_contract_version === 2
        ? {
            regional_regulated_categories: c.regional_regulated_categories,
            regional_regulation_identities: c.regional_regulation_identities,
            ...(c.objective === "OUTCOME_AWARENESS"
              ? { promoted_object: c.promoted_object }
              : {}),
          }
        : {}),
      ...(c.objective === "OUTCOME_TRAFFIC"
        ? { destination_type: "WEBSITE" }
        : {}),
    },
    creative: c.creative_source === "facebook_post" ? {
      name: `${c.name} · Creative`, object_story_id: c.source_post.provider_post_id,
    } : {
      name: `${c.name} · Creative`,
      object_story_spec: {
        page_id: c.page_id,
        ...(c.placements !== "facebook_feed"
          ? { instagram_user_id: c.instagram_id }
          : {}),
        link_data: {
          image_hash: ids.image_hash,
          link: c.url,
          message: c.caption,
          name: c.headline,
          call_to_action: { type: "LEARN_MORE", value: { link: c.url } },
        },
      },
    },
    ad: {
      name: `${c.name} · Ad`,
      adset_id: ids.adset_id,
      creative: { creative_id: ids.creative_id },
      status: "PAUSED",
    },
  };
}
async function verifyCreativeAccess(
  graph: MetaGraph,
  token: string,
  config: any,
  guard: () => Promise<void>,
) {
  const rows = await adsPages(
    graph,
    "me/accounts",
    token,
    { fields: "id,tasks,instagram_business_account{id}" },
    guard,
  );
  const page = rows.find((p) => p.id === config.page_id);
  if (
    !page ||
    !Array.isArray(page.tasks) ||
    !page.tasks.some((t: string) =>
      [
        "ADVERTISE",
        "MANAGE",
        "PROFILE_PLUS_ADVERTISE",
        "PROFILE_PLUS_FULL_CONTROL",
      ].includes(t),
    )
  )
    throw new MetaError("ad_page_authorization_unverified");
  if (
    config.placements !== "facebook_feed" &&
    page.instagram_business_account?.id !== config.instagram_id
  )
    throw new MetaError("ad_instagram_identity_unverified");
}
// Public SDK fields; a missing eligibility signal fails closed rather than guessing.
export async function verifyAdsCreateReadiness(graph: MetaGraph,token: string,config: any,guard: () => Promise<void>) {
  await verifyCreativeAccess(graph,token,config,guard);
  if (config.create_contract_version !== 3) return;
  if (config.audience?.type === "city") {
    await guard();
    const result = await graph.request("search",token,{type:"adgeolocation",location_types:["city"],country_code:"MY",q:config.audience.name,limit:25});
    if (!result.data?.some((r:any)=>r.key===config.audience.key && r.country_code==="MY" && r.type==="city" && r.name===config.audience.name))
      throw new MetaError("ad_city_authorization_unverified");
  }
  if (config.creative_source === "facebook_post") {
    if(config.objective!=="OUTCOME_AWARENESS" || config.placements!=="facebook_feed" || config.source_post?.page_id!==config.page_id)
      throw new MetaError("ad_source_post_incompatible");
    await guard();
    const post = await graph.request(config.source_post.provider_post_id,token,{fields:"id,from{id},message,is_published,is_eligible_for_promotion,allowed_advertising_objectives,attachments{media_type}"});
    const attachments=post.attachments?.data||[];
    if(post.id!==config.source_post.provider_post_id || post.from?.id!==config.page_id || post.is_published!==true || post.is_eligible_for_promotion!==true || (post.message||"")!==config.source_post.caption
      || !Array.isArray(post.allowed_advertising_objectives) || !post.allowed_advertising_objectives.includes(config.objective)
      || (config.source_post.format==="image" ? attachments.length!==1 || attachments[0].media_type!=="photo" : attachments.length!==0))
      throw new MetaError("ad_source_post_unverified");
  }
}
export async function advanceAdsChange({
  graph,
  token,
  change,
  state,
  bytes,
  guard,
  checkpoint,
  reconcileOnly = false,
}: any) {
  const account = change.account_id;
  if (!numericId(account)) throw new MetaError("ad_account_identity_mismatch");
  if (state.pending && !reconcileOnly)
    return { outcome: "reconciling", code: "manual_reconciliation_required" };
  if (change.operation !== "create") {
    const tree = await campaignTree(
      graph,
      token,
      account,
      change.configuration.campaign_id,
      guard,
    );
    const field = change.operation === "budget" ? "lifetime_budget" : "status",
      expected =
        change.operation === "budget"
          ? String(change.maximum_budget)
          : change.operation === "pause"
            ? "PAUSED"
            : "ACTIVE";
    if (reconcileOnly) {
      // Receipt plus read-after-write evidence; absence of a receipt never becomes success.
      if (!state.update_accepted)
        return {
          outcome: "reconciling",
          code: "manual_reconciliation_required",
        };
      if (
        change.configuration.resume_scope === "feedx_hierarchy" &&
        (!tree.adsets.every((r: any) => r.status === "ACTIVE") ||
          !tree.ads.every((r: any) => r.status === "ACTIVE"))
      )
        return { outcome: "reconciling", code: "meta_state_changed" };
      if (String(tree.campaign?.[field]) !== expected)
        return { outcome: "reconciling", code: "meta_state_changed" };
      return {
        outcome: "succeeded",
        receipt: {
          account_id: account,
          campaign_id: tree.campaign.id,
          fingerprint: change.fingerprint,
          reconciled: true,
          configuration: tree.campaign,
        },
      };
    }
    if (canonical(tree) !== canonical(change.baseline))
      throw new MetaError("meta_configuration_changed");
    if (change.configuration.resume_scope === "feedx_hierarchy") {
      // Children become ACTIVE while the parent remains PAUSED. Parent activation is the final write.
      for (const row of [...tree.adsets, ...tree.ads]) {
        await guard();
        await checkpoint({ ...state, pending: `activate_${row.id}` });
        const accepted = await graph.request(
          row.id,
          token,
          { status: "ACTIVE" },
          "POST",
        );
        if (accepted.success !== true)
          throw new MetaError("ads_mutation_receipt_unreadable", true);
        state = {
          ...state,
          pending: null,
          activated: [...(state.activated || []), row.id],
        };
        await checkpoint(state);
      }
    }
    await guard();
    await checkpoint({ ...state, pending: "update" });
    const result = await graph.request(
      change.configuration.campaign_id,
      token,
      { [field]: expected },
      "POST",
    );
    if (result.success !== true)
      throw new MetaError("ads_mutation_receipt_unreadable", true);
    state = { ...state, pending: null, update_accepted: true };
    await checkpoint(state);
    return advanceAdsChange({
      graph,
      token,
      change,
      state,
      guard,
      checkpoint,
      reconcileOnly: true,
    });
  }
  if (reconcileOnly && state.pending)
    return { outcome: "reconciling", code: "manual_reconciliation_required" };
  if (!reconcileOnly) {
    if (change.configuration.adset_contract_version !== 2)
      throw new MetaError("adset_declaration_revision_required");
    if (Date.parse(change.configuration.start_time) <= Date.now())
      throw new MetaError("ad_schedule_elapsed");
    await verifyAdsCreateReadiness(graph, token, change.configuration, guard);
    if (change.configuration.creative_source !== "facebook_post" && (
      !bytes ||
      (await bytesHash(bytes)) !== change.configuration.media.sha256
    ))
      throw new MetaError("ad_creative_changed");
  }
  // Every accepted creation is checkpointed. A pending POST is never automatically repeated.
  for (const step of (change.configuration.creative_source === "facebook_post" ? ["campaign", "adset", "creative", "ad"] : ["image", "campaign", "adset", "creative", "ad"])) {
    const key = step === "image" ? "image_hash" : `${step}_id`;
    if (state[key]) continue;
    if (reconcileOnly || state.pending)
      return { outcome: "reconciling", code: "manual_reconciliation_required" };
    await guard();
    if(step==="creative" && change.configuration.creative_source==="facebook_post")
      await verifyAdsCreateReadiness(graph,token,change.configuration,guard);
    await checkpoint({ ...state, pending: step });
    let body: any;
    if (step === "image") {
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      body = await graph.request(
        `act_${account}/adimages`,
        token,
        { bytes: btoa(binary) },
        "POST",
      );
      const images = Object.values(body.images || {}) as any[];
      if (images.length !== 1 || typeof images[0]?.hash !== "string")
        throw new MetaError("ads_mutation_receipt_unreadable", true);
      state = { ...state, image_hash: images[0].hash, pending: null };
    } else {
      const payloads = createPayloads(change, state);
      const edge = {
        campaign: "campaigns",
        adset: "adsets",
        creative: "adcreatives",
        ad: "ads",
      }[step]!;
      body = await graph.request(
        `act_${account}/${edge}`,
        token,
        payloads[step as keyof typeof payloads],
        "POST",
      );
      if (!numericId(body.id))
        throw new MetaError("ads_mutation_receipt_unreadable", true);
      state = { ...state, [key]: body.id, pending: null };
    }
    await checkpoint(state);
  }
  const tree = await campaignTree(
    graph,
    token,
    account,
    state.campaign_id,
    guard,
  );
  const campaign = tree.campaign,
    set = tree.adsets.find((r: any) => r.id === state.adset_id),
    ad = tree.ads.find((r: any) => r.id === state.ad_id);
  const spec = ad?.creative?.object_story_spec,
    expectedSpec = createPayloads(change, state).creative.object_story_spec;
  const matchingCreative = change.configuration.creative_source === "facebook_post"
    ? ad?.creative?.object_story_id === change.configuration.source_post.provider_post_id
    : !!expectedSpec && spec?.page_id === expectedSpec.page_id &&
    (change.configuration.placements === "facebook_feed" ||
      spec?.instagram_user_id === expectedSpec.instagram_user_id) &&
    ["image_hash", "link", "message", "name"].every(
      (k) =>
        spec?.link_data?.[k] ===
        expectedSpec.link_data[k as keyof typeof expectedSpec.link_data],
    );
  const targeting = set?.targeting;
  let matchingDeclaration = true;
  if (change.configuration.adset_contract_version === 2 && set?.id) {
    await guard();
    const declaration = await graph.request(set.id, token, {
      fields:
        "regional_regulated_categories,regional_regulation_identities,promoted_object",
    });
    matchingDeclaration =
      canonical(declaration.regional_regulated_categories) ===
        canonical(change.configuration.regional_regulated_categories) &&
      ["universal_beneficiary", "universal_payer"].every(
        (key) =>
          declaration.regional_regulation_identities?.[key] ===
          change.configuration.regional_regulation_identities?.[key],
      ) &&
      (change.configuration.objective !== "OUTCOME_AWARENESS" ||
        declaration.promoted_object?.page_id ===
          change.configuration.promoted_object?.page_id);
  }
  const matchingAudience =
    (change.configuration.create_contract_version === 3
      ? matchingLocalAudience(targeting?.geo_locations,change.configuration.audience)
      : canonical(targeting?.geo_locations?.countries) === canonical(["MY"])) &&
    Number(targeting?.age_min) === Number(change.configuration.age_min) &&
    Number(targeting?.age_max) === Number(change.configuration.age_max) &&
    canonical([...(targeting?.publisher_platforms || [])].sort()) ===
      canonical(
        [
          ...createPayloads(change, state).adset.targeting.publisher_platforms,
        ].sort(),
      );
  const expectedTargeting=createPayloads(change,state).adset.targeting;
  const matchingPlacements=["facebook_positions","instagram_positions"].every(key=>canonical([...(targeting?.[key]||[])].sort())===canonical([...(expectedTargeting[key]||[])].sort()));
  const matchingSchedule =
    Date.parse(set?.start_time) ===
      Date.parse(change.configuration.start_time) &&
    Date.parse(set?.end_time) === Date.parse(change.configuration.end_time);
  if (
    !matchingCreative ||
    !matchingAudience ||
    !matchingSchedule || !matchingPlacements ||
    !matchingDeclaration ||
    set?.optimization_goal !==
      createPayloads(change, state).adset.optimization_goal ||
    set?.billing_event !== "IMPRESSIONS" ||
    !campaign ||
    campaign.status !== "PAUSED" ||
    String(campaign.lifetime_budget) !== String(change.maximum_budget) ||
    campaign.objective !== change.configuration.objective ||
    !set ||
    set.status !== "PAUSED" ||
    !ad ||
    ad.status !== "PAUSED" ||
    ad.creative?.id !== state.creative_id
  )
    return { outcome: "reconciling", code: "meta_receipt_not_reconciled" };
  return {
    outcome: "succeeded",
    receipt: {
      account_id: account,
      campaign_id: state.campaign_id,
      adset_id: state.adset_id,
      creative_id: state.creative_id,
      ad_id: state.ad_id,
      ...(change.configuration.creative_source==="facebook_post" ? {source_post_id:change.configuration.source_post.provider_post_id} : {image_hash:state.image_hash}),
      fingerprint: change.fingerprint,
      reconciled: true,
      status: "PAUSED",
      configuration: tree,
    },
  };
}
export async function executeAdsChange(
  db: any,
  graph: MetaGraph,
  env: (n: string) => string,
  claim: any,
) {
  const call = async (name: string, args: any) => {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new MetaError("ads_authority_changed");
    return data;
  };
  const args = { p_request: claim.id, p_lease: claim.lease };
  const guard = async () => {
    if (
      !claim.provider_state?.reconcile_only &&
      (env("MARKETING_ADS_EXECUTION_ENABLED") !== "true" ||
        !env("MARKETING_ADS_EXECUTION_APPROVALS")
          .split(",")
          .includes(claim.fingerprint))
    )
      throw new MetaError("ads_execution_disabled");
    return call("marketing_ads_change_material", args);
  };
  try {
    const material = await guard(),
      c = material.connection;
    const grant = await unseal(
      c.sealed_token,
      [
        env("MARKETING_META_TOKEN_ENCRYPTION_KEY"),
        env("MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY"),
      ],
      connectionBinding(c),
    );
    const health = await verifyAdsAccount(
      graph,
      env("MARKETING_META_APP_ID"),
      env("MARKETING_META_APP_SECRET"),
      grant.token,
      c.provider_account_id,
      c.meta_user_id,
      async () => {
        await guard();
      },
    );
    if (!claim.provider_state?.reconcile_only && !health.manage_verified)
      throw new MetaError(health.manage_reason);
    let bytes: Uint8Array | undefined;
    if (claim.operation === "create" && claim.configuration.creative_source !== "facebook_post" && !claim.provider_state?.reconcile_only) {
      const m = claim.configuration.media;
      const { data, error } = await db.storage
        .from("marketing-media")
        .download(m.object_path);
      if (error || !data || data.size !== m.size_bytes)
        throw new MetaError("ad_media_unavailable");
      bytes = new Uint8Array(await data.arrayBuffer());
      verifyMetaMedia(bytes, m.mime_type, "facebook");
    }
    const result = await advanceAdsChange({
      graph,
      token: grant.token,
      change: claim,
      state: claim.provider_state,
      bytes,
      reconcileOnly: claim.provider_state?.reconcile_only === true,
      guard: async () => {
        await guard();
      },
      checkpoint: (p_state: any) =>
        call("marketing_ads_change_checkpoint", { ...args, p_state }),
    });
    await call("marketing_ads_change_finish", {
      ...args,
      p_outcome: result.outcome,
      p_receipt: result.receipt || null,
      p_error: result.code || null,
    });
    return result.outcome;
  } catch (error) {
    // A provider/DB/network failure after any write-ahead intent can be ambiguous.
    const { data: material } = await db.rpc(
      "marketing_ads_change_material",
      args,
    );
    const pending = material?.change?.provider_state?.pending;
    const accepted =
      material?.change?.provider_state &&
      Object.keys(material.change.provider_state).some(
        (k) =>
          k.endsWith("_id") ||
          k === "image_hash" ||
          k === "update_accepted" ||
          (k === "activated" &&
            material.change.provider_state.activated?.length > 0),
      );
    const code =
      error instanceof MetaError ? error.code : "ads_execution_interrupted";
    // Preserve pending intent and accepted IDs; diagnostics never authorize a retry.
    if (material && error instanceof MetaError && error.adsEvidence) {
      try {
        await call("marketing_ads_change_checkpoint", {
          ...args,
          p_state: {
            ...material.change.provider_state,
            last_error: error.adsEvidence,
          },
        });
      } catch {
        /* Evidence failure must not mask the original safe outcome. */
      }
    }
    const outcome =
      !material ||
      pending ||
      accepted ||
      (error instanceof MetaError && error.uncertain)
        ? "reconciling"
        : code === "meta_configuration_changed"
          ? "stale"
          : "failed";
    await call("marketing_ads_change_finish", {
      ...args,
      p_outcome: outcome,
      p_receipt: null,
      p_error: code,
    });
    return outcome;
  }
}
