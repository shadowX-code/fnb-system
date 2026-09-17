function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function titleCase(value) {
  const text = String(value || "").replaceAll("_", " ").trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "On hand";
}

function locationSummary(index, locationId) {
  if (!index.has(locationId)) index.set(locationId, { rawMaterials: new Map(), finishedGoods: new Map() });
  return index.get(locationId);
}

function sortedRows(rows) {
  return [...rows].sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "en"));
}

export function buildLocationInventoryIndex({ rawMaterialBatches = [], finishedGoodBatches = [] } = {}) {
  const locations = new Map();

  rawMaterialBatches.filter((batch) => number(batch.current_balance) > 0 && batch.storage_location_id).forEach((batch) => {
    const material = batch.raw_material || {};
    const location = locationSummary(locations, batch.storage_location_id);
    const materialId = batch.raw_material_id || material.id;
    if (!materialId) return;
    if (!location.rawMaterials.has(materialId)) {
      location.rawMaterials.set(materialId, {
        id: materialId,
        name: material.name_en || material.name || "Raw Material",
        code: material.material_code || "",
        uom: batch.uom || material.uom || "",
        quantity: 0,
        batches: [],
      });
    }
    const row = location.rawMaterials.get(materialId);
    row.quantity += number(batch.current_balance);
    row.batches.push({
      id: batch.id,
      batch_no: batch.internal_batch_no || batch.supplier_lot_no || "—",
      quantity: number(batch.current_balance),
      uom: batch.uom || material.uom || "",
      status: titleCase(batch.status),
    });
  });

  finishedGoodBatches.filter((batch) => number(batch.current_balance) > 0 && batch.storage_location_id).forEach((batch) => {
    const finishedGood = batch.finished_good || {};
    const family = finishedGood.product_family || {};
    const location = locationSummary(locations, batch.storage_location_id);
    const finishedGoodId = batch.finished_good_id || finishedGood.id;
    if (!finishedGoodId) return;
    if (!location.finishedGoods.has(finishedGoodId)) {
      location.finishedGoods.set(finishedGoodId, {
        id: finishedGoodId,
        name: family.name_en || finishedGood.product_name_en || finishedGood.product_name || "Finished Good",
        code: finishedGood.product_code || "",
        uom: finishedGood.uom || "",
        quantity: 0,
        batches: [],
      });
    }
    const row = location.finishedGoods.get(finishedGoodId);
    row.quantity += number(batch.current_balance);
    row.batches.push({
      id: batch.id,
      batch_no: batch.batch_no || "—",
      quantity: number(batch.current_balance),
      uom: finishedGood.uom || "",
      status: "On hand",
    });
  });

  return new Map([...locations.entries()].map(([locationId, value]) => [locationId, {
    rawMaterials: sortedRows([...value.rawMaterials.values()]).map((row) => ({ ...row, batches: [...row.batches].sort((left, right) => left.batch_no.localeCompare(right.batch_no, "en")) })),
    finishedGoods: sortedRows([...value.finishedGoods.values()]).map((row) => ({ ...row, batches: [...row.batches].sort((left, right) => left.batch_no.localeCompare(right.batch_no, "en")) })),
  }]));
}

export function locationInventoryCountLabel(summary, { includeRawMaterials = true, includeFinishedGoods = true } = {}) {
  if (!summary) return "Empty";
  const labels = [];
  if (includeRawMaterials && summary.rawMaterials.length) labels.push(`${summary.rawMaterials.length} RM`);
  if (includeFinishedGoods && summary.finishedGoods.length) labels.push(`${summary.finishedGoods.length} FG`);
  return labels.join(" · ") || "Empty";
}
