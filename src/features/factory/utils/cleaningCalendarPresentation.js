import { malaysiaBusinessDateInput } from "./factoryDates.js";

// Monthly presentation only. Never pass derived status to a lifecycle action.
export function cleaningOccurrenceStatus(record, today = malaysiaBusinessDateInput()) {
  return record.status === "pending" && record.due_date && record.due_date < today ? "missed" : record.status;
}
export function cleaningCalendarPresentation(cell, today = malaysiaBusinessDateInput()) {
  const records = cell.occurrences?.length ? cell.occurrences : [cell];
  const counts = {};
  for (const record of records) {
    const status = cleaningOccurrenceStatus({ ...record, due_date: record.due_date || cell.due_date }, today);
    counts[status] = (counts[status] || 0) + 1;
  }
  const statuses = Object.keys(counts);
  const status = counts.unsatisfactory ? "unsatisfactory" : counts.missed ? "missed" : statuses.length === 1 ? statuses[0] : "mixed";
  const total = cell.total_count || records.length;
  const names = {pending:"Pending",missed:"Missed",completed:"Completed",verified:"Verified",unsatisfactory:"Fail",mixed:"Mixed"};
  return { status, label: `${names[status] || status}${total > 1 ? ` (${total})` : ""}`, description: statuses.map(key=>`${names[key] || key}: ${counts[key]}`).join(", ") };
}
