export function money(value) {
  return `RM${Number(value || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function packSizeText(sku) {
  return Number(sku?.pack_size_qty || 0) > 0
    ? `${sku.pack_size_qty} ${sku.pack_size_uom || ""}`.trim()
    : "";
}

export function quantity(value, uom) {
  return `${Number(value || 0).toLocaleString("en-MY", { maximumFractionDigits: 2 })}${uom ? ` ${uom}` : ""}`;
}

export function signedQuantity(value, uom) {
  const numeric = Number(value || 0);
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toLocaleString("en-MY", { maximumFractionDigits: 2 })}${uom ? ` ${uom}` : ""}`;
}

export function ledgerQuantity(value, uom, { signed = false } = {}) {
  const numeric = Number(value || 0);
  const formatted = Math.abs(numeric).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = signed ? numeric > 0 ? "+" : numeric < 0 ? "-" : "" : numeric < 0 ? "-" : "";
  return `${sign}${formatted}${uom ? ` ${uom}` : ""}`;
}

export function ledgerQuantityList(rows) {
  const values = Array.isArray(rows) ? rows : [];
  return values.length ? values.map((row) => ledgerQuantity(row.quantity, row.uom)).join(" · ") : "—";
}

export function percent(value) {
  return `${Number(value || 0).toLocaleString("en-MY", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function productionTimeLabel(minutes) {
  const totalMinutes = Number(minutes || 0);
  if (!totalMinutes) return "Not set";
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

export function sopStepEstimatedMinutes(step) {
  const subSteps = Array.isArray(step?.sub_steps) ? step.sub_steps : [];
  if (subSteps.length) return subSteps.reduce((sum, subStep) => sum + (Number(subStep.estimated_minutes || 0) || 0), 0);
  const minutes = Number(step?.estimated_time_minutes || 0);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : 0;
}

export function sopTotalEstimatedMinutes(sop) {
  const steps = Array.isArray(sop?.steps) ? sop.steps : [];
  if (steps.length) return steps.reduce((sum, step) => sum + sopStepEstimatedMinutes(step), 0);
  const minutes = Number(sop?.estimated_minutes || 0);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : 0;
}

export function sopMinutesLabel(minutes) {
  const numeric = Number(minutes || 0);
  return `${Number.isFinite(numeric) && numeric >= 0 ? numeric.toLocaleString("en-MY") : "0"} mins`;
}

export function validSopMinutes(value) {
  if (value === null || value === undefined || value === "") return true;
  const numeric = Number(value);
  return Number.isFinite(numeric) && Number.isInteger(numeric) && numeric >= 0;
}
