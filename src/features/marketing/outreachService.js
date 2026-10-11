import { supabase } from "../../lib/supabase";
import { throwSupabaseError } from "../../services/supabaseError.js";
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  throwSupabaseError(`marketing.${name}`, error);
  return data;
}
export const outreachService = {
  read: (org, brand, campaign = null, page = 1, search = "") =>
    rpc("marketing_outreach_read", {
      p_org: org,
      p_brand: brand,
      p_campaign: campaign,
      p_page: page,
      p_search: search,
    }),
  customer: (request, org, brand, payload) =>
    rpc("platform_customer_command", {
      p_request: request,
      p_org: org,
      p_brand: brand,
      p_payload: payload,
    }),
  command: (request, org, brand, action, id, payload = {}) =>
    rpc("marketing_outreach_command", {
      p_request: request,
      p_org: org,
      p_brand: brand,
      p_action: action,
      p_id: id || null,
      p_payload: payload,
    }),
};
