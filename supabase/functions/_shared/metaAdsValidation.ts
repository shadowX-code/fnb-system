import { MetaError, MetaGraph } from "./metaGraph.ts";
import { createPayloads } from "./metaAdsManagement.ts";
// Diagnostic validation only. This route cannot create objects or release execution leases.
export async function validatePausedAdSet(
  graph: MetaGraph,
  token: string,
  change: any,
  guard: () => Promise<void>,
) {
  const id = change.provider_state?.campaign_id;
  if (
    change.state !== "reconciling" ||
    change.operation !== "create" ||
    change.provider_state?.pending !== "adset" ||
    !/^\d{1,30}$/.test(id || "") ||
    change.provider_state.adset_id ||
    change.provider_state.creative_id ||
    change.provider_state.ad_id
  )
    throw new MetaError("adset_validation_not_available");
  await guard();
  const campaign = await graph.request(id, token, {
    fields:
      "id,account_id,name,status,effective_status,objective,buying_type,lifetime_budget,bid_strategy,special_ad_categories",
  });
  if (
    campaign.id !== id ||
    campaign.account_id !== change.account_id ||
    campaign.status !== "PAUSED" ||
    campaign.effective_status !== "PAUSED" ||
    campaign.name !== change.configuration.name ||
    campaign.objective !== change.configuration.objective ||
    campaign.buying_type !== "AUCTION" ||
    String(campaign.lifetime_budget) !== String(change.maximum_budget) ||
    campaign.bid_strategy !== "LOWEST_COST_WITHOUT_CAP" ||
    !Array.isArray(campaign.special_ad_categories) ||
    campaign.special_ad_categories.length
  )
    throw new MetaError("meta_configuration_changed");
  const request = createPayloads(change, change.provider_state).adset;
  await guard();
  try {
    // Server-forced; caller cannot supply parameters or remove validate_only.
    const result = await graph.request(
      `act_${change.account_id}/adsets`,
      token,
      { ...request, execution_options: ["validate_only"] },
      "POST",
    );
    if (result.success !== true || result.id)
      throw new MetaError("adset_validation_response_unreadable", true);
    return {
      mode: "validate_only",
      valid: true,
      campaign_matches: true,
      campaign_id: id,
      adset_request: request,
    };
  } catch (error) {
    if (!(error instanceof MetaError) || !error.adsEvidence) throw error;
    return {
      mode: "validate_only",
      valid: false,
      campaign_matches: true,
      campaign_id: id,
      adset_request: request,
      error_code: error.code,
      error: error.adsEvidence,
    };
  }
}
