import { supabase } from "../lib/supabase";
import {readCompleteRows} from '../../supabase/functions/_shared/completeRows.js';

export async function readCompleteInventoryRows(table, { select = "*", order = "id", ascending = true, eq = {}, in: inFilters = {} } = {}) {
  return readCompleteRows(table, async (offset, end) => {
    let query = supabase.from(table).select(select, { count: "exact" }).order(order, { ascending });
    if (order !== "id") query = query.order("id", { ascending: true });
    for (const [column, value] of Object.entries(eq)) query = query.eq(column, value);
    for (const [column, values] of Object.entries(inFilters)) query = query.in(column, values);
    return query.range(offset, end);
  });
}
