import { quantity, signedQuantity } from "./factoryFormatters.js";

export function traceBatchNo(batch) {
  const sourceType = String(batch?.batch_type || batch?.source_type || "").toLowerCase();
  return sourceType && sourceType !== "production" ? "—" : batch?.batch_no || "—";
}

export function tracePackQuantity(value) { return quantity(value, Number(value || 0) === 1 ? "Pack" : "Packs"); }
export function traceSignedPackQuantity(value) { return signedQuantity(value, Number(Math.abs(value || 0)) === 1 ? "Pack" : "Packs"); }

export function traceLocationStatus(batch) {
  const state = String(batch?.storage_location_status || "").toLowerCase();
  if (!batch?.storage_location_id && !batch?.storage_location_name) return { label: "Unavailable", tone: "warning" };
  if (state === "active") return { label: "Active", tone: "success" };
  if (["archived", "inactive"].includes(state)) return { label: "Archived", tone: "neutral" };
  return { label: "Unavailable", tone: "warning" };
}

export function traceTimeline(batch, dispatches, positiveAdjustmentEvents, stockCheckAdjustments) {
  const sourceType = String(batch?.batch_type || "").toLowerCase();
  const isProduction = sourceType === "production";
  const isAdjustment = sourceType === "adjustment";
  const timeline = [
    ...(isProduction ? [{ id: `opening-${batch.id}`, date: batch.source_event_at || batch.manufacturing_date || batch.created_at, dateOnly: !batch.source_event_at, type: "Production Opening", reference: batch.job_order_no || "—", quantity: Number(batch.original_qty || 0), balance: Number(batch.original_qty || 0), order: 0 }] : []),
    ...positiveAdjustmentEvents.map((adjustment) => ({ id: `positive-adjustment-${adjustment.event_id}`, date: adjustment.adjustment_date, dateOnly: false, type: "Stock Check Increase", reference: adjustment.stock_check_reference || "—", quantity: Number(adjustment.quantity || 0), balance: null, order: 0 })),
    ...(isAdjustment && Number(batch.adjustment_carried_forward_qty || 0) > 0 ? [{ id: `adjustment-carried-${batch.id}`, date: "", type: "Adjustment balance carried forward", reference: "—", quantity: Number(batch.adjustment_carried_forward_qty), balance: null, order: 0 }] : []),
    ...(!isProduction && !isAdjustment ? [{ id: `legacy-carried-${batch.id}`, date: "", type: "Legacy balance carried forward", reference: batch.source_reference || "—", quantity: Number(batch.original_qty || 0), balance: null, order: 0 }] : []),
    ...dispatches.map((dispatch) => ({ id: `dispatch-${dispatch.allocation_id}`, date: dispatch.dispatch_date, dateOnly: true, type: "Completed Dispatch", reference: dispatch.dispatch_no || "—", quantity: -Number(dispatch.quantity || 0), balance: null, order: 1 })),
    ...stockCheckAdjustments.map((adjustment) => ({ id: `stock-check-${adjustment.adjustment_id}`, date: adjustment.adjustment_date, dateOnly: false, type: "Stock Check Adjustment", reference: adjustment.stock_check_reference || "—", quantity: -Number(adjustment.quantity || 0), balance: null, order: 2 })),
  ].sort((left, right) => new Date(left.date || 0).getTime() - new Date(right.date || 0).getTime() || left.order - right.order || String(left.id).localeCompare(String(right.id)));
  timeline.push({ id: `current-${batch.id}`, date: "", type: "Current Remaining Balance", reference: traceBatchNo(batch), quantity: null, balance: Number(batch.current_balance || 0) });
  return timeline;
}
