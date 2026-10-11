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
  customers: (org,brand,filters={},page=1,size=20) => rpc("marketing_customers_read",{p_org:org,p_brand:brand,p_filters:filters,p_page:page,p_size:size}),
  importPreview: (org,brand,rows) => rpc("platform_customer_import_preview",{p_org:org,p_brand:brand,p_rows:rows}),
  importCommit: (request,org,brand,rows,decisions) => rpc("platform_customer_import_commit",{p_request:request,p_org:org,p_brand:brand,p_rows:rows,p_decisions:decisions}),
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
