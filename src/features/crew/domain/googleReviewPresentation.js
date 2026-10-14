export const googleReviewRatings = Object.freeze({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 });

// This transient display projection never supplies Performance or persists derived metrics.
export function googleRatingOverview(context, now = Date.now()) {
  if (context?.connection_status !== 'connected' || !context.mapping?.name || context.sync_status !== 'complete'
    || !(Date.parse(context.cache_expires_at) > now) || !Array.isArray(context.reviews)) return null;
  const counts = [0, 0, 0, 0, 0], identities = new Set();
  let sum = 0;
  for (const review of context.reviews) {
    const rating = googleReviewRatings[review.starRating];
    if (!rating || !review.name?.startsWith(`${context.mapping.name}/reviews/`) || identities.has(review.name)) return null;
    identities.add(review.name); ++counts[rating - 1]; sum += rating;
  }
  const total = context.reviews.length, official = context.google_aggregate;
  if (official && (official.location !== context.mapping.name || official.totalReviewCount !== total
    || official.averageRating !== undefined && (!Number.isFinite(official.averageRating) || official.averageRating < 1 || official.averageRating > 5))) return null;
  const useOfficial = total > 0 && Number.isFinite(official?.averageRating);
  return { counts, total, average: total ? useOfficial ? official.averageRating : sum / total : null, source: useOfficial ? 'google' : 'synced' };
}
