// Presentation only: metrics and provider readiness come from the server.
export function googleReviewsState(context) {
  if (!context) return { key: "loading", title: "Loading Google Reviews", description: "Loading outlet and month context." };
  if (context.api_status !== "available") return { key: "api_pending", title: "Google Business Profile API access pending", description: "Reviews and Customer points are unavailable, not zero. Connection will be available after API and policy approval." };
  if (context.connection_status === "error") return { key: "connection_error", title: "Google connection needs attention", description: "Reconnect the authorized business account when the provider is available." };
  if (context.connection_status !== "connected") return { key: "disconnected", title: "Google Reviews is not connected", description: "Connect an authorized business account in Settings." };
  if (!context.location_resource_name) return { key: "unmapped", title: "Choose this outlet’s Google Location", description: "Map a verified location explicitly in Settings. Outlet names are never matched automatically." };
  if (context.sync_status === "running") return { key: "syncing", title: "Syncing Google Reviews", description: "Monthly evidence remains unavailable until reconciliation completes." };
  if (context.sync_status === "error") return { key: "sync_error", title: "Review sync needs attention", description: "The last sync did not complete. Incomplete evidence cannot be used for Performance." };
  if (context.evidence_status !== "complete") return { key: "awaiting_sync", title: "Waiting for verified monthly reviews", description: "A complete sync is required before monthly review evidence is available." };
  if (context.target_locked) return { key: "finalized", title: "Finalized month", description: "Performance evidence and the monthly target are locked. Live review changes do not recalculate finalized results." };
  return (context.reviews || []).length || context.new_reviews > 0
    ? { key: "available", title: "Monthly review evidence available", description: "Reviews are attributed to the month they were created, not cumulative Google totals." }
    : { key: "empty", title: "No reviews created this month", description: "The verified sync is complete. No eligible reviews were found for this outlet and month." };
}

export const hasGoogleReviewEvidence = (context) => context?.api_status === "available" && context.connection_status === "connected" && Boolean(context.location_resource_name) && context.evidence_status === "complete" && context.sync_status !== "running" && context.sync_status !== "error";
