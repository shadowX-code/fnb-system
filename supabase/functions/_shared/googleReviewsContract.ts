// Server-only, dormant integration contract. No network, credentials or persistence.
// Google content must not enter this boundary before policy approval.
export interface GoogleReviewRecord {
  name: string;
  createTime: string;
  updateTime: string;
  starRating: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE";
}
export interface GoogleReviewPage {
  reviews: GoogleReviewRecord[];
  nextPageToken?: string;
}
export interface GoogleReviewsProvider {
  listAccounts(pageToken?: string): Promise<{ accounts: { name: string; displayName: string }[]; nextPageToken?: string }>;
  listLocations(account: string, pageToken?: string): Promise<{ locations: { name: string; title: string }[]; nextPageToken?: string }>;
  listReviews(location: string, pageToken?: string): Promise<GoogleReviewPage>;
}
export const GOOGLE_REVIEWS_CAPABILITY = Object.freeze({ apiAvailable: false, policyApproved: false, customerScoringEnabled: false });
const ratings = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export function requireGoogleProvider(gate: { apiAvailable: boolean; policyApproved: boolean }) {
  if (!gate.apiAvailable || !gate.policyApproved) throw new Error("Google Reviews integration is not approved.");
}

// A failed/partial page walk never returns complete monthly evidence. A last-sync
// watermark is diagnostic only: the reviews endpoint has no incremental filter.
export async function reconcileGoogleReviewMonth(provider: GoogleReviewsProvider, location: string, period: string,
  gate: { apiAvailable: boolean; policyApproved: boolean }) {
  requireGoogleProvider(gate);
  if (!/^accounts\/[^/]+\/locations\/[^/]+$/.test(location) || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(period)) throw new Error("Verified location and whole month required.");
  const seenTokens = new Set<string>();
  const reviews = new Map<string, GoogleReviewRecord>();
  let token: string | undefined;
  let pages = 0;
  do {
    if (++pages > 10000) throw new Error("Google review reconciliation did not complete.");
    const page = await provider.listReviews(location, token);
    if (!Array.isArray(page.reviews)) throw new Error("Invalid Google review page.");
    for (const review of page.reviews) {
      if (!review.name.startsWith(`${location}/reviews/`) || review.name.slice(`${location}/reviews/`.length).includes("/") || !review.name.slice(`${location}/reviews/`.length)
        || !ratings[review.starRating] || !Number.isFinite(Date.parse(review.createTime)) || !Number.isFinite(Date.parse(review.updateTime))) throw new Error("Invalid Google review evidence.");
      const previous = reviews.get(review.name);
      if (Date.parse(review.updateTime) < Date.parse(review.createTime)
        || (previous && Date.parse(previous.createTime) !== Date.parse(review.createTime))) throw new Error("Invalid Google review creation evidence.");
      if (!previous || Date.parse(review.updateTime) > Date.parse(previous.updateTime)) reviews.set(review.name, review);
      else if (review.updateTime === previous.updateTime && (review.starRating !== previous.starRating || review.createTime !== previous.createTime)) throw new Error("Conflicting Google review revision.");
    }
    token = page.nextPageToken || undefined;
    if (token && seenTokens.has(token)) throw new Error("Repeated Google page token.");
    if (token) seenTokens.add(token);
  } while (token);
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit" });
  const breakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const review of reviews.values()) {
    const parts = month.formatToParts(new Date(review.createTime));
    const key = `${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}`;
    if (key === period.slice(0, 7)) ++breakdown[ratings[review.starRating]];
  }
  const positive = breakdown[4] + breakdown[5];
  const negative = breakdown[1] + breakdown[2];
  const total = positive + negative + breakdown[3];
  return { evidence_status: "complete", pages, total, positive, negative, breakdown,
    negativeRate: total ? negative / total : null,
    averageRating: total ? Object.entries(breakdown).reduce((sum, [rating, count]) => sum + Number(rating) * count, 0) / total : null };
}

// Approved weights, not wired to Performance. Zero eligible reviews has no
// quality denominator; the approved rule keeps Customer pending, never 5 by default.
export function previewGoogleCustomerScore(evidence: { evidence_status: string; total: number; positive: number; negative: number }, target: number) {
  if (evidence.evidence_status !== "complete" || !Number.isSafeInteger(target) || target <= 0) return { status: "pending", score: null };
  if (![evidence.total, evidence.positive, evidence.negative].every(n => Number.isSafeInteger(n) && n >= 0) || evidence.positive + evidence.negative > evidence.total) throw new Error("Invalid monthly Google evidence.");
  if (!evidence.total) return { status: "pending", score: null, reason: "no_eligible_reviews" };
  const rate = evidence.negative / evidence.total;
  const quality = rate <= 0.02 ? 5 : rate <= 0.05 ? 4 : rate <= 0.10 ? 3 : rate <= 0.15 ? 2 : rate <= 0.20 ? 1 : 0;
  const positiveTarget = Math.min(evidence.positive / target, 1) * 15;
  return { status: "preview_only", score: Math.round((positiveTarget + quality) * 100) / 100, positiveTarget, quality };
}
