import { percent, quantity } from "../../utils/factoryFormatters.js";

export default function FactoryDashboardChartTooltip({ active, payload, mode }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return <div className="min-w-[210px] rounded-lg border border-border bg-white p-3 text-xs shadow-lg"><div className="font-black text-text-primary">{row.product || "—"}</div><div className="mb-2 text-text-secondary">{row.packaging_sku || "—"}</div>{mode === "dispatch" ? <><div>Dispatch Qty: <strong>{quantity(row.dispatch_qty, "packs")}</strong></div><div>Dispatch Count: <strong>{Number(row.dispatch_count || 0)}</strong></div><div>Customer Count: <strong>{Number(row.customer_count || 0)}</strong></div><div>Share: <strong>{percent(row.share_percent)}</strong></div></> : <><div>Output: <strong>{quantity(row.output_qty, row.uom)}</strong></div><div>Batch Count: <strong>{Number(row.batch_count || 0)}</strong></div><div>Completion Rate: <strong>{percent(row.completion_rate)}</strong></div></>}</div>;
}
