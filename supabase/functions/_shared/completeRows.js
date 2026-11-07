// Complete collections are authoritative only after stable count and identity checks.
export async function readCompleteRows(label, readPage, {pageSize=500}={}) {
  const rows = [];
  const ids = new Set();
  let expected;
  for (let offset = 0; ; offset += pageSize) {
    const result = await readPage(offset, offset + pageSize - 1);
    if (result.error) throw Object.assign(new Error(`${label}: ${result.error.message || "read failed"}`), { readState: "error", cause: result.error });
    if (!Number.isInteger(result.count) || result.count < 0 || !Array.isArray(result.data)) {
      throw Object.assign(new Error(`${label}: completeness could not be verified.`), { readState: "incomplete" });
    }
    if (expected === undefined) expected = result.count;
    if (result.count !== expected) throw Object.assign(new Error(`${label}: data changed during loading. Refresh to retry.`), { readState: "incomplete" });
    for (const row of result.data) {
      if (!row.id || ids.has(row.id)) throw Object.assign(new Error(`${label}: overlapping or invalid page. Refresh to retry.`), { readState: "incomplete" });
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length === expected) return { data: rows, count: expected, error: null, completeness: "complete" };
    if (rows.length > expected || result.data.length < pageSize) throw Object.assign(new Error(`${label}: incomplete read (${rows.length} of ${expected} rows).`), { readState: "incomplete" });
  }
}
