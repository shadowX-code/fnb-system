import { supabase } from "../lib/supabase";
// Commercial availability requires explicit activation after installer signing.
export const factoryLabelsEnabled =
  import.meta.env.VITE_FACTORY_LABEL_PRINTING_ENABLED === "true" &&
  import.meta.env.VITE_SUPABASE_URL ===
  "https://oyfobxdoyfuzsodogpgs.supabase.co";
export const bridgeInstallerVersion = "1.3.0";
const bridgeInstallers = new Map([
  ["windows", {
    fileName: "FeedX-Print-Bridge-Production-Windows.exe",
    sha256: "891145ec85652ccacec16bb58eecb1353cd17b2342dc46a76985ecdf4199263c",
  }],
  ["macos", {
    fileName: "FeedX-Print-Bridge-Production-macOS-arm64.pkg",
    sha256: "a17b847e21d193988cbed2f88786bc7f85e4f67dd433f3929e958eed67d48836",
  }],
]);

async function rpc(name, args, signal) {
  if (!factoryLabelsEnabled)
    throw new Error("Factory label printing is currently unavailable.");
  const query = supabase.rpc(`factory_label_${name}`, args);
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return data;
}
export const factoryLabelService = {
  async downloadInstaller(platform) {
    if (!factoryLabelsEnabled) throw new Error("Factory label printing is currently unavailable.");
    const installer = bridgeInstallers.get(platform);
    if (!installer) throw new Error("Select a supported operating system.");
    const { fileName, sha256 } = installer;
    const { data, error } = await supabase.storage.from("factory-print-bridge-installers")
      .download(`${bridgeInstallerVersion}/${fileName}`, {}, { cache: "no-store" });
    if (error || !data) throw new Error("Installer unavailable. Sign in with an account authorized to set up Factory printers.");
    const digest = await crypto.subtle.digest("SHA-256", await data.arrayBuffer());
    const checksum = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (checksum !== sha256) throw new Error("Installer integrity check failed. Contact FeedX support.");
    return { fileName, file: data };
  },

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
