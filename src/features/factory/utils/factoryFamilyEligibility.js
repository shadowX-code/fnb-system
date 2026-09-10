const active = (record) => String(record?.status || "").toLowerCase() === "active";

export function finishedGoodFamiliesWithoutRecords(productFamilies = [], records = [], selectedFamilyId = "") {
  const existingFamilyIds = new Set((records || []).flatMap((record) => [
    record?.product_family_id,
    record?.finished_good_id,
    record?.product_family?.id,
    record?.finished_good?.id,
  ]).filter(Boolean).map(String));
  return (productFamilies || []).filter((family) => active(family) && (String(family.id) === String(selectedFamilyId || "") || !existingFamilyIds.has(String(family.id))));
}

export function hasFinishedGoodFamilyRecord(records = [], finishedGoodId) {
  const candidateId = String(finishedGoodId || "");
  return Boolean(candidateId && (records || []).some((record) => [record?.product_family_id, record?.finished_good_id, record?.product_family?.id, record?.finished_good?.id].filter(Boolean).map(String).includes(candidateId)));
}
