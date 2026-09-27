import { describe, expect, it } from "vitest";
import { googleReviewsState, hasGoogleReviewEvidence } from "../googleReviewsState.js";

const connected = { api_status: "available", connection_status: "connected", location_resource_name: "accounts/a/locations/l", evidence_status: "complete", new_reviews: 0, reviews: [] };
describe("Google review presentation states", () => {
  it.each([
    [{ api_status: "pending_allowlist" }, "api_pending"],
    [{ api_status: "available" }, "disconnected"],
    [{ api_status: "available", connection_status: "error" }, "connection_error"],
    [{ ...connected, location_resource_name: null }, "unmapped"],
    [{ ...connected, sync_status: "running" }, "syncing"],
    [{ ...connected, sync_status: "error" }, "sync_error"],
    [{ ...connected, evidence_status: "unavailable" }, "awaiting_sync"],
    [connected, "empty"],
    [{ ...connected, new_reviews: 1 }, "available"],
    [{ ...connected, target_locked: true }, "finalized"],
  ])("uses authoritative readiness for %s", (context, key) => expect(googleReviewsState(context).key).toBe(key));
  it("does not expose stale or partial evidence as available", () => {
    expect(hasGoogleReviewEvidence(connected)).toBe(true);
    for (const override of [{ api_status: "pending_allowlist" }, { sync_status: "error" }, { sync_status: "running" }, { evidence_status: "partial" }, { location_resource_name: null }]) expect(hasGoogleReviewEvidence({ ...connected, ...override })).toBe(false);
  });
});
