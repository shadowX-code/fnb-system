export function productionJobOrderReference(production) {
  return production?.job_order_no
    || production?.job?.job_order_no
    || production?.job_order?.job_order_no
    || "—";
}

export function productionBatchReference(production) {
  return production?.batch_no || productionJobOrderReference(production);
}

export function operatorFinishedGoodBatchNo(batch) {
  const sourceType = String(batch?.batch_type || batch?.source_type || "").toLowerCase();
  return sourceType && sourceType !== "production" ? "—" : batch?.batch_no || "—";
}
