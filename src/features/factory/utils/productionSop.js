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

export function productionSopStructure(sop) {
  const steps = Array.isArray(sop?.steps) ? sop.steps : [];
  return {
    stepCount: steps.length,
    subStepCount: steps.reduce((count, step) => count + (Array.isArray(step.sub_steps) ? step.sub_steps.length : 0), 0),
    qcCount: steps.reduce((count, step) => count + (Array.isArray(step.qc_checks) && step.qc_checks.length ? step.qc_checks.length : (step.qc_required || step.is_qc_checkpoint ? 1 : 0)), 0),
  };
}

// This mirrors the trusted activation guard: only a current active Equipment
// binding makes a Draft SOP ready to activate. It is a read-only projection.
export function productionSopReadiness(sop, equipment = []) {
  if (String(sop?.status || "").toLowerCase() === "archived") {
    return { key: "not_applicable", label: "Not applicable", tone: "gray", isReady: false };
  }
  const activeEquipmentIds = new Set((equipment || []).filter((item) => item.status === "active").map((item) => item.id));
  const hasActiveEquipment = (sop?.equipment_ids || []).some((equipmentId) => activeEquipmentIds.has(equipmentId));
  return hasActiveEquipment
    ? { key: "ready", label: "Ready", tone: "green", isReady: true }
    : { key: "equipment_missing", label: "Equipment missing", tone: "amber", isReady: false };
}

export function productFirstProductionSops(sops, equipment = []) {
  return groupedProductionSops(sops).map((group) => {
    const versions = group.sops.map((sop) => ({
      ...sop,
      productName: group.productName,
      productNameCn: group.productNameCn,
      structure: productionSopStructure(sop),
      readiness: productionSopReadiness(sop, equipment),
      versionCount: group.sops.length,
    }));
    return { ...versions[0], versions };
  });
}

export function productionSopDisplayName(sop) {
  const productName = sop?.product_name_en || sop?.product_name || "Finished Good";
  return `${productName} Production SOP · ${sop?.version || "v1"}`;
}
