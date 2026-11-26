import { supabase } from "../lib/supabase";
// Commercial availability requires explicit activation after installer signing.
export const factoryLabelsEnabled =
  import.meta.env.VITE_FACTORY_LABEL_PRINTING_ENABLED === "true" &&
  import.meta.env.VITE_SUPABASE_URL ===
  "https://oyfobxdoyfuzsodogpgs.supabase.co";
async function rpc(name, args, signal) {
  if (!factoryLabelsEnabled)
    throw new Error("Factory label printing is currently unavailable.");
  const query = supabase.rpc(`factory_label_${name}`, args);
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
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
  printStatus: (order, job, device) =>
    rpc("print_status", { p_job_order: order, p_job: job || null, p_device: device || null }),
  resolve: (job, state, reason, usableQuantity) =>
    rpc("resolve", {
      p_job: job,
      p_state: state,
      p_reason: reason,
      p_usable_quantity: usableQuantity,
    }),
};

Object.assign(factoryLabelService, {
  management: (section = "products", page = 1, search = "", { signal } = {}) =>
    rpc("management", { p_section: section, p_page: page, p_search: search }, signal),
  editor: (kind, key) => rpc("editor", { p_kind: kind, p_key: key }),
  saveDraft: (kind, key, payload, revision, baseVersion, requestId) =>
    rpc("save_draft", {
      p_kind: kind,
      p_key: key,
      p_payload: payload,
      p_revision: revision,
      p_base_version: baseVersion,
      p_request_id: requestId,
    }),
  publish: (draft, revision, requestId, note, approved) =>
    rpc("publish", {
      p_draft: draft,
      p_revision: revision,
      p_request_id: requestId,
      p_approval_note: note,
      p_content_approved: approved,
    }),
  renameDevice: (device, name) =>
    rpc("rename_device", { p_device: device, p_name: name }),
  setDeviceEnabled: (device, enabled, reason) =>
    rpc("set_device_enabled", {
      p_device: device,
      p_enabled: enabled,
      p_reason: reason,
    }),
});
