import { describe, expect, it, vi } from "vitest";
import { GOOGLE_REVIEWS_CAPABILITY, reconcileGoogleReviewMonth, previewGoogleCustomerScore } from "../googleReviewsContract.ts";
const location = "accounts/a/locations/l";
const gate = { apiAvailable: true, policyApproved: true };
const review = (id: string, starRating = "FIVE", createTime = "2026-09-01T00:00:00Z", updateTime = createTime) => ({ name: `${location}/reviews/${id}`, starRating, createTime, updateTime });
const provider = (pages: unknown[]) => ({ listAccounts: vi.fn(), listLocations: vi.fn(), listReviews: vi.fn().mockImplementation(() => Promise.resolve(pages.shift())) });
describe("dormant server Google review contract", () => {
  it("never contacts a provider while API or policy approval is unavailable", async () => {
    const p = provider([]);
    await expect(reconcileGoogleReviewMonth(p, location, "2026-09-01", GOOGLE_REVIEWS_CAPABILITY)).rejects.toThrow("not approved");
    expect(p.listReviews).not.toHaveBeenCalled();
  });
  it("reconciles all pages, deduplicates external identity and uses creation month in Malaysia", async () => {
    const p = provider([{ reviews: [review("a"), review("old", "FIVE", "2026-07-01T00:00:00Z", "2026-09-01T00:00:00Z")], nextPageToken: "next" }, { reviews: [review("a"), review("b", "TWO", "2026-08-31T16:01:00Z")] }]);
    expect(await reconcileGoogleReviewMonth(p, location, "2026-09-01", gate)).toMatchObject({ total: 2, positive: 1, negative: 1, negativeRate: 0.5 });
    expect(p.listReviews).toHaveBeenNthCalledWith(2, location, "next");
  });
  it("uses updated ratings without moving review creation month", async () => {
    const p = provider([{ reviews: [review("a"), review("a", "ONE", "2026-09-01T00:00:00Z", "2026-09-03T00:00:00Z")] }]);
    expect(await reconcileGoogleReviewMonth(p, location, "2026-09-01", gate)).toMatchObject({ total: 1, negative: 1 });
  });
  it("rejects an external identity whose immutable creation date changes", async () => {
    const p = provider([{ reviews: [review("a"), review("a", "ONE", "2026-08-01T00:00:00Z", "2026-09-03T00:00:00Z")] }]);
    await expect(reconcileGoogleReviewMonth(p, location, "2026-09-01", gate)).rejects.toThrow("creation evidence");
  });
  it("does not carry forward reviews absent from a subsequent complete reconciliation", async () => {
    const p = provider([{ reviews: [review("a")] }, { reviews: [] }]);
    expect(await reconcileGoogleReviewMonth(p, location, "2026-09-01", gate)).toMatchObject({ total: 1 });
    expect(await reconcileGoogleReviewMonth(p, location, "2026-09-01", gate)).toMatchObject({ total: 0, negativeRate: null });
  });
  it("fails closed for a partial sync, repeated token or foreign location", async () => {
    const p = provider([{ reviews: [], nextPageToken: "next" }, { reviews: [], nextPageToken: "next" }]);
    await expect(reconcileGoogleReviewMonth(p, location, "2026-09-01", gate)).rejects.toThrow("Repeated");
    const foreign = provider([{ reviews: [{ ...review("a"), name: "accounts/other/locations/l/reviews/a" }] }]);
    await expect(reconcileGoogleReviewMonth(foreign, location, "2026-09-01", gate)).rejects.toThrow("Invalid");
    const failed = provider([]); failed.listReviews.mockRejectedValue(new Error("Provider unavailable"));
    await expect(reconcileGoogleReviewMonth(failed, location, "2026-09-01", gate)).rejects.toThrow("Provider unavailable");
  });
  it.each([[2,5],[3,4],[5,4],[6,3],[10,3],[11,2],[15,2],[16,1],[20,1],[21,0]])("preserves quality boundary at %s percent", (negative, quality) => {
    expect(previewGoogleCustomerScore({ evidence_status: "complete", total: 100, positive: 50, negative }, 50)).toMatchObject({ quality, score: 15 + quality });
  });
  it("keeps missing/zero-denominator evidence pending and caps the approved positive target", () => {
    expect(previewGoogleCustomerScore({ evidence_status: "partial", total: 100, positive: 100, negative: 0 }, 50).score).toBeNull();
    expect(previewGoogleCustomerScore({ evidence_status: "complete", total: 0, positive: 0, negative: 0 }, 50).score).toBeNull();
    expect(previewGoogleCustomerScore({ evidence_status: "complete", total: 10, positive: 5, negative: 0 }, 10)).toMatchObject({ positiveTarget: 7.5, score: 12.5 });
  });
});
