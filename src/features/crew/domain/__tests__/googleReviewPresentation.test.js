import { describe, expect, it } from 'vitest';
import { googleRatingOverview } from '../googleReviewPresentation.js';
const name = 'accounts/a/locations/l';
const context = { connection_status: 'connected', mapping: { name }, sync_status: 'complete', cache_expires_at: '2026-10-15T00:00:00Z', reviews: ['FIVE', 'FOUR', 'THREE', 'TWO', 'ONE'].map((starRating, i) => ({ name: `${name}/reviews/${i}`, starRating })) };
const now = Date.parse('2026-10-14T00:00:00Z');
describe('Transient outlet rating overview', () => {
  it('counts all five ratings and labels the complete synced fallback distinctly', () => {
    expect(googleRatingOverview(context, now)).toEqual({ counts: [1, 1, 1, 1, 1], total: 5, average: 3, source: 'synced' });
  });
  it('prefers the verified official location aggregate over a computed average', () => {
    expect(googleRatingOverview({ ...context, google_aggregate: { location: name, totalReviewCount: 5, averageRating: 3.14 } }, now)).toMatchObject({ average: 3.14, source: 'google' });
  });
  it.each(['running', 'error', 'awaiting_sync'])('never uses an incomplete %s cache as a rating', sync_status => {
    expect(googleRatingOverview({ ...context, sync_status }, now)).toBeNull();
  });
  it('rejects expired, disconnected, foreign-location and duplicate evidence', () => {
    expect(googleRatingOverview(context, Date.parse(context.cache_expires_at))).toBeNull();
    expect(googleRatingOverview({ ...context, connection_status: 'disconnected' }, now)).toBeNull();
    expect(googleRatingOverview({ ...context, reviews: [{ name: 'accounts/a/locations/foreign/reviews/1', starRating: 'FIVE' }] }, now)).toBeNull();
    expect(googleRatingOverview({ ...context, reviews: [context.reviews[0], context.reviews[0]] }, now)).toBeNull();
    expect(googleRatingOverview({ ...context, google_aggregate: { location: name, totalReviewCount: 10, averageRating: 4 } }, now)).toBeNull();
  });
  it('shows truthful zero counts and an unavailable average for a complete empty dataset', () => {
    expect(googleRatingOverview({ ...context, reviews: [] }, now)).toEqual({ counts: [0, 0, 0, 0, 0], total: 0, average: null, source: 'synced' });
  });
});
