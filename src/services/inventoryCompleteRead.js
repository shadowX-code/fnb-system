import { supabase } from "../lib/supabase";

// Full Inventory collections feed balances and joins: a capped response is not
// an authoritative empty/complete collection. Keep PO's focused reader separate.
export async function readCompleteInventoryRows(table, { select = "*", order = "id", ascending = true } = {}) {
  const rows = [];
  const ids = new Set();
  let expected;
  for (let offset = 0; ; offset += 500) {
    let query = supabase.from(table).select(select, { count: "exact" }).order(order, { ascending });
    if (order !== "id") query = query.order("id", { ascending: true });
    const result = await query.range(offset, offset + 499);
    if (result.error) throw Object.assign(new Error(`${table}: ${result.error.message || "read failed"}`), { readState: "error", cause: result.error });
    if (!Number.isInteger(result.count) || result.count < 0 || !Array.isArray(result.data)) {
      throw Object.assign(new Error(`${table}: completeness could not be verified.`), { readState: "incomplete" });
    }
    if (expected === undefined) expected = result.count;
    if (result.count !== expected) throw Object.assign(new Error(`${table}: data changed during loading. Refresh to retry.`), { readState: "incomplete" });
    for (const row of result.data) {
      if (!row.id || ids.has(row.id)) throw Object.assign(new Error(`${table}: overlapping or invalid page. Refresh to retry.`), { readState: "incomplete" });
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length === expected) return { data: rows, count: expected, error: null, completeness: "complete" };
    if (rows.length > expected || result.data.length < 500) throw Object.assign(new Error(`${table}: incomplete read (${rows.length} of ${expected} rows).`), { readState: "incomplete" });
  }
}
