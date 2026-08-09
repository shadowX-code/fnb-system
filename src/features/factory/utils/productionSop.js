export function groupedProductionSops(sops) {
  const groups = new Map();
  (sops || []).forEach((sop) => {
    const storedProductName = sop.product_name_en || sop.product_name || "";
    const productName = storedProductName || "Finished Good";
    const legacyIdentity = String(storedProductName).trim().toLocaleLowerCase("en-MY");
    const key = sop.finished_good_id ? `finished-good:${sop.finished_good_id}` : legacyIdentity ? `legacy-product:${legacyIdentity}` : `legacy-sop:${sop.id}`;
    if (!groups.has(key)) groups.set(key, { id: key, productName, productNameCn: sop.product_name_cn || "", sops: [] });
    groups.get(key).sops.push(sop);
  });
  return [...groups.values()]
    .map((group) => ({
      ...group,
      sops: group.sops.sort((left, right) => (
        String(right.version || "").localeCompare(String(left.version || ""), "en-MY", { numeric: true, sensitivity: "base" })
        || String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || ""))
        || String(left.id || "").localeCompare(String(right.id || ""))
      )),
    }))
    .sort((left, right) => left.productName.localeCompare(right.productName, "en-MY", { numeric: true, sensitivity: "base" }) || left.id.localeCompare(right.id));
}

export function productionSopDisplayName(sop) {
  const productName = sop?.product_name_en || sop?.product_name || "Finished Good";
  return `${productName} Production SOP · ${sop?.version || "v1"}`;
}
