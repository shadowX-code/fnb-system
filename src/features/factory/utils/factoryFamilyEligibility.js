const active = (record) => String(record?.status || "").toLowerCase() === "active";

export function finishedGoodFamiliesWithoutRecords(productFamilies = [], records = [], selectedFamilyId = "") {
  const existingFamilyIds = new Set((records || []).map((record) => record?.product_family_id || record?.finished_good_id).filter(Boolean));
  return (productFamilies || []).filter((family) => active(family) && (family.id === selectedFamilyId || !existingFamilyIds.has(family.id)));
}

export function hasFinishedGoodFamilyRecord(records = [], finishedGoodId) {
  return Boolean(finishedGoodId && (records || []).some((record) => (record?.product_family_id || record?.finished_good_id) === finishedGoodId));
}
