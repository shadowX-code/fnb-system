export function rawMovementTypeMeta(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "receiving") return { label: "Receiving", tone: "success" };
  if (normalized === "production usage") return { label: "Production Usage", tone: "warning" };
  if (normalized === "stock check adjustment") return { label: "Stock Check Adjustment", tone: "info" };
  if (normalized === "transfer") return { label: "Transfer", tone: "info" };
  if (normalized === "opening balance") return { label: "Opening Balance", tone: "neutral" };
  return { label: value || "Movement", tone: "neutral" };
}

export function statusTone(status) {
  if (status === "approved" || status === "completed") return "success";
  if (status === "submitted") return "info";
  if (status === "cancelled") return "danger";
  if (status === "in_progress" || status === "released" || status === "planned") return "info";
  return "neutral";
}

export function jobStatusLabel(status) {
  if (status === "in_progress") return "In Progress";
  return String(status || "draft").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function jobPriorityTone(priority) {
  if (priority === "Urgent") return "danger";
  if (priority === "High") return "warning";
  return "neutral";
}
