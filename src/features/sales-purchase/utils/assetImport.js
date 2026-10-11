// Import parsing and row projection are intentionally UI-independent so the
// route only coordinates the import workflow.

function canonical(value = "") {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export const assetImportColumns = ["Asset Name", "Asset Code", "Outlet Code", "Category", "Quantity", "Minimum Quantity", "Condition", "Location", "Purchase Date", "Warranty Expiry", "Status", "Description", "Notes"];

export function emptyAsset() {
  return {
    outlet_id: "", category_id: "", asset_code: "", name: "", description: "", location: "",
    purchase_date: null, warranty_expiry: null, notes: "", unit: "unit", current_quantity: 0,
    minimum_quantity: 0, status: "active", condition: "healthy", maintenance_override: "inherit",
    image_url: "", remark: "",
  };
}

export function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadTextFile(filename, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function normalizeOutletRecord(outlet = {}) {
  const source = Array.isArray(outlet.outlets) ? outlet.outlets[0] : (outlet.outlets || outlet.outlet || outlet);
  const id = source?.id ?? outlet.outlet_id ?? outlet.id ?? "";
  const code = source?.code ?? source?.outlet_code ?? source?.shortCode ?? source?.short_code ?? source?.abbreviation ?? outlet.code ?? outlet.outlet_code ?? outlet.short_code ?? "";
  const name = source?.name ?? source?.outlet_name ?? source?.outletName ?? outlet.name ?? outlet.outlet_name ?? "";
  return { ...outlet, ...source, id, code: String(code || "").trim(), name: String(name || "").trim() };
}

function outletDisplayCode(outlet = {}) {
  const normalized = normalizeOutletRecord(outlet);
  return normalized.code || normalized.name || normalized.id || "Outlet";
}

export { parseCsv, parseXlsx } from "../../../lib/tabularFile.js";

function readImportValue(row, aliases) {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const found = entries.find(([key]) => canonical(key) === canonical(alias));
    if (found) return String(found[1] ?? "").trim();
  }
  return "";
}

function parseImportDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return text;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, day, month, year] = slash;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isValidDateInput(value) {
  if (!value) return true;
  const normalized = parseImportDate(value);
  if (!normalized) return false;
  const date = new Date(`${normalized}T00:00:00`);
  return !Number.isNaN(date.getTime()) && normalized === `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const assetImportConditionMap = new Map([["good", "healthy"], ["fair", "needs_attention"], ["needsattention", "needs_attention"], ["damaged", "damaged"], ["disposed", "disposed"]]);
const assetImportStatusMap = new Map([["active", "active"], ["inactive", "archived"], ["disposed", "archived"]]);

export function buildAssetImportPreview(rows, { assets, outlets, categories }) {
  const outletByCode = new Map(outlets.map((outlet) => {
    const normalized = normalizeOutletRecord(outlet);
    return [canonical(normalized.code || ""), normalized];
  }).filter(([key]) => key));
  const categoryByName = new Map(categories.filter((category) => category.is_active !== false).map((category) => [canonical(category.name), category]));
  const existingByCodeOutlet = new Map();
  const existingByNameOutlet = new Map();
  assets.forEach((asset) => {
    const outletKey = canonical(asset.outlet_id);
    const addMatch = (map, key) => map.set(key, [...(map.get(key) || []), asset]);
    if (asset.asset_code) addMatch(existingByCodeOutlet, `${canonical(asset.asset_code)}:${outletKey}`);
    addMatch(existingByNameOutlet, `${canonical(asset.name)}:${outletKey}`);
  });
  return rows.map((row) => {
    const assetName = readImportValue(row, ["Asset Name", "Name", "Asset"]);
    const assetCode = readImportValue(row, ["Asset Code", "Code"]);
    const outletCode = readImportValue(row, ["Outlet Code", "Outlet"]);
    const categoryName = readImportValue(row, ["Category"]);
    const quantityText = readImportValue(row, ["Quantity", "Current Quantity"]);
    const minimumText = readImportValue(row, ["Minimum Quantity", "Minimum Qty", "Min Quantity"]);
    const conditionText = readImportValue(row, ["Condition"]) || "Good";
    const location = readImportValue(row, ["Location"]);
    const purchaseDateText = readImportValue(row, ["Purchase Date"]);
    const warrantyExpiryText = readImportValue(row, ["Warranty Expiry", "Warranty Expiry Date"]);
    const statusText = readImportValue(row, ["Status"]) || "Active";
    const description = readImportValue(row, ["Description"]);
    const photoUrl = readImportValue(row, ["Photo URL", "Image URL"]);
    const notes = readImportValue(row, ["Notes", "Remark"]);
    const errors = [];
    if (!assetName) errors.push("Missing Asset Name");
    const outlet = outletByCode.get(canonical(outletCode));
    if (!outletCode) errors.push("Missing Outlet Code");
    if (outletCode && !outlet) errors.push(`Unknown Outlet Code: ${outletCode}`);
    const category = categoryByName.get(canonical(categoryName));
    if (!categoryName) errors.push("Missing Category");
    if (categoryName && !category) errors.push("Unknown Category");
    const quantity = quantityText === "" ? NaN : Number(quantityText);
    if (!Number.isFinite(quantity) || quantity < 0) errors.push("Invalid Quantity");
    const minimumQuantity = minimumText === "" ? 0 : Number(minimumText);
    if (!Number.isFinite(minimumQuantity) || minimumQuantity < 0) errors.push("Invalid Minimum Quantity");
    const condition = assetImportConditionMap.get(canonical(conditionText));
    if (!condition) errors.push("Invalid Condition");
    const status = assetImportStatusMap.get(canonical(statusText));
    if (!status) errors.push("Invalid Status");
    if (purchaseDateText && !isValidDateInput(purchaseDateText)) errors.push("Invalid Purchase Date");
    if (warrantyExpiryText && !isValidDateInput(warrantyExpiryText)) errors.push("Invalid Warranty Expiry");
    if (photoUrl && !/^https?:\/\//i.test(photoUrl)) errors.push("Invalid Photo URL");
    const outletKey = canonical(outlet?.id);
    const matches = assetCode ? (existingByCodeOutlet.get(`${canonical(assetCode)}:${outletKey}`) || []) : (existingByNameOutlet.get(`${canonical(assetName)}:${outletKey}`) || []);
    if (matches.length > 1) errors.push(assetCode ? "Ambiguous Asset Code for this outlet" : "Ambiguous asset name for this outlet; provide Asset Code");
    const existing = matches.length === 1 ? matches[0] : null;
    const merged = {
      ...emptyAsset(), ...(existing || {}), id: existing?.id || "", asset_code: assetCode || existing?.asset_code || "",
      outlet_id: outlet?.id || "", category_id: category?.id || existing?.category_id || "", name: assetName,
      description: description || existing?.description || "", image_url: photoUrl || existing?.image_url || "",
      thumbnail_url: photoUrl || existing?.thumbnail_url || "", condition: canonical(statusText) === "disposed" ? "disposed" : (condition || existing?.condition || "healthy"),
      current_quantity: Number.isFinite(quantity) ? quantity : 0, minimum_quantity: Number.isFinite(minimumQuantity) ? minimumQuantity : 0,
      status: status || "active", unit: existing?.unit || "unit", location: location || existing?.location || "",
      purchase_date: purchaseDateText ? parseImportDate(purchaseDateText) : existing?.purchase_date || null,
      warranty_expiry: warrantyExpiryText ? parseImportDate(warrantyExpiryText) : existing?.warranty_expiry || null,
      notes: notes || existing?.notes || "", remark: notes || existing?.remark || "",
    };
    return {
      rowNumber: row.__row, source: row, action: errors.length ? "error" : existing ? "update" : "create", errors, existing, outlet, category, asset: merged,
      display: { assetName, outlet: outlet ? `${outlet.name} (${outletDisplayCode(outlet)})` : outletCode, category: category?.name || categoryName, quantity: quantityText, condition: conditionText, status: statusText },
    };
  });
}
