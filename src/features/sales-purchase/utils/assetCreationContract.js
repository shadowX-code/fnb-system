export const ASSET_CREATE_UNIT_OPTIONS = [
  { value: "unit", label: "Units" },
  { value: "piece", label: "Pieces" },
  { value: "set", label: "Sets" },
  { value: "box", label: "Boxes" },
  { value: "bottle", label: "Bottles" },
  { value: "pair", label: "Pairs" },
];

const supportedUnits = new Set(ASSET_CREATE_UNIT_OPTIONS.map((option) => option.value));

export function normalizeAssetCreateValues(values = {}) {
  const quantity = Number(values.initial_quantity ?? values.current_quantity ?? 0);
  return {
    name: String(values.name || "").trim(),
    category_id: String(values.category_id || "").trim(),
    initial_quantity: Number.isFinite(quantity) ? quantity : Number.NaN,
    unit: String(values.unit || "unit").trim().toLowerCase(),
    asset_code: String(values.asset_code || "").trim(),
    location: String(values.location || "").trim(),
    description: String(values.description || "").trim(),
  };
}

export function validateAssetCreateValues(values = {}, activeCategoryIds = []) {
  const normalized = normalizeAssetCreateValues(values);
  if (!normalized.name) return "Enter an asset name.";
  if (!normalized.category_id) return "Choose a category.";
  if (activeCategoryIds.length && !activeCategoryIds.includes(normalized.category_id)) return "Choose an active category.";
  if (!Number.isFinite(normalized.initial_quantity) || normalized.initial_quantity < 0) return "Enter a valid initial quantity.";
  if (!supportedUnits.has(normalized.unit)) return "Choose a supported unit.";
  return "";
}

export function buildCrewAssetCreatePayload(values = {}) {
  return normalizeAssetCreateValues(values);
}

export function applyAdminAssetCreateContract(values = {}) {
  const normalized = normalizeAssetCreateValues(values);
  return {
    ...values,
    ...normalized,
    current_quantity: normalized.initial_quantity,
    minimum_quantity: 0,
    condition: "healthy",
    remark: "",
  };
}

export function assetCreateErrorMessage(stage, error) {
  const detail = String(error?.message || "").toLowerCase();
  if (detail.includes("asset code") && (detail.includes("already") || detail.includes("duplicate"))) return "That asset code is already in use. Check it and try again.";
  if (detail.includes("active asset category") || detail.includes("active category")) return "That category is no longer available. Choose another category.";
  if (detail.includes("special access") || detail.includes("permission") || detail.includes("not authorized")) return "Your Asset access has changed. Refresh and try again.";
  if (stage === "photo") return "The asset was created, but its photo could not be attached. Your photo is still here. Try again.";
  return "The asset could not be added. Your details are still here. Try again.";
}
