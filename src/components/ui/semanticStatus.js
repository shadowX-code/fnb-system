const toneByStatus = {
  active: "success",
  approved: "success",
  available: "success",
  certified: "success",
  completed: "success",
  complete: "success",
  finalized: "success",
  healthy: "success",
  in_stock: "success",
  paid: "success",
  published: "success",
  qualified: "success",
  reconciled: "success",
  resolved: "success",
  verified: "success",
  exception: "warning",
  awaiting: "warning",
  awaiting_performance: "warning",
  awaiting_verification: "warning",
  needs_attention: "warning",
  needs_renewal: "warning",
  low_balance: "warning",
  low_stock: "warning",
  legacy_unallocated: "warning",
  pending: "warning",
  review: "warning",
  review_required: "warning",
  unpublished_changes: "warning",
  cancelled: "neutral",
  draft: "neutral",
  inactive: "neutral",
  locked: "neutral",
  not_applicable: "neutral",
  not_started: "neutral",
  unavailable: "neutral",
  archived: "neutral",
  depleted: "neutral",
  expired: "danger",
  failed: "danger",
  incomplete: "danger",
  mismatch: "danger",
  missed: "danger",
  out_of_stock: "danger",
  critical: "danger",
  error: "danger",
  destructive: "danger",
  in_progress: "info",
  released: "info",
  rejected: "danger",
  scheduled: "info",
  on_shift: "info",
};

export function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function semanticStatusTone(status, fallback = "neutral") {
  return toneByStatus[normalizeStatus(status)] || fallback;
}

export function lifecycleLabel(status, { unpublishedChanges = false } = {}) {
  if (unpublishedChanges) return "Published · Unpublished changes";
  const normalized = normalizeStatus(status);
  return {
    draft: "Draft",
    published: "Published",
    finalized: "Finalized",
    locked: "Locked",
    completed: "Completed",
  }[normalized] || String(status || "Unavailable");
}
