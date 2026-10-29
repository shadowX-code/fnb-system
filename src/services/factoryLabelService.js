import { supabase } from "../lib/supabase";
// Delivery is intentionally confined to the exact Staging data environment.
export const factoryLabelsEnabled =
  import.meta.env.VITE_SUPABASE_URL ===
  "https://ujkzdaaadnvcfayuldmh.supabase.co";
async function rpc(name, args) {
  if (!factoryLabelsEnabled)
    throw new Error("Factory label printing is available on Staging only.");
  const { data, error } = await supabase.rpc(`factory_label_${name}`, args);
  if (error) throw error;
  return data;
}
export const factoryLabelService = {
  settings: (sku) => rpc("settings", { p_sku: sku }),
  saveConfig: (sku, config, version, requestId) =>
    rpc("save_config", {
      p_sku: sku,
      p_config: config,
      p_expected_version: version,
      p_request_id: requestId,
    }),
  context: (job, production = null, overrides = {}, page = 1) =>
    rpc("context", {
      p_job_order: job,
      p_production: production,
      p_overrides: overrides,
      p_page: page,
    }),
  enqueue: (args) => rpc("enqueue", args),
  resolve: (job, state, reason) =>
    rpc("resolve", { p_job: job, p_state: state, p_reason: reason }),
};
