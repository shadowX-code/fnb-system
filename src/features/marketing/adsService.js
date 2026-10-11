import { supabase } from "../../lib/supabase";
import { throwSupabaseError } from "../../services/supabaseError.js";
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  throwSupabaseError(`marketing.${name}`, error);
  return data;
}
async function command(path, body) {
  const { data, error } = await supabase.functions.invoke(
    `marketing-ads/${path}`,
    { body },
  );
  if (error) {
    let message = "Ad Account connection could not be completed.";
    if (error.context instanceof Response)
      try {
        message = (await error.context.json()).error || message;
      } catch {}
    throw new Error(message);
  }
  return data;
}
export const adsService = {
  read: (org, brand, from, to) =>
    rpc("marketing_ads_read", {
      p_org: org,
      p_brand: brand || null,
      p_from: from,
      p_to: to,
    }),
  pending: (org, brand) =>
    rpc("marketing_ads_pending", { p_org: org, p_brand: brand }),
  authorize: (organizationId, brandId) =>
    command("authorize", { organizationId, brandId }),
  preview: (sessionId, accountId, from, to) =>
    command("preview", { sessionId, accountId, from, to }),
  discovery: (org) => rpc("marketing_ads_discovery_read", { p_org: org }),
  bind: (sessionId, brandId, accountId, expectedGeneration = null) =>
    command("bind", {
      sessionId,
      brandId,
      accountId,
      expectedGeneration,
      confirmOwnership: true,
    }),
  sync: (connection, from, to) =>
    rpc("marketing_ads_request_sync", {
      p_connection: connection,
      p_from: from,
      p_to: to,
    }),
  disconnect: (connection) =>
    rpc("marketing_meta_disconnect", { p_connection: connection }),
};
