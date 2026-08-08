export function uniqueReceivingBatchPreview(candidate, items, rowId) {
  const value = String(candidate || "");
  const match = /^(.*-)(\d+)$/.exec(value);
  if (!match) return value;
  const used = new Set((items || []).filter((item) => item.row_id !== rowId).map((item) => item.internal_batch_no).filter(Boolean));
  let sequence = Number(match[2]);
  let next = value;
  while (used.has(next)) {
    sequence += 1;
    next = `${match[1]}${String(sequence).padStart(match[2].length, "0")}`;
  }
  return next;
}
