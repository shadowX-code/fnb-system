import { Star } from 'lucide-react';
import AdminSummaryGrid from '../../../components/ui/AdminSummaryGrid.jsx';
import Card from '../../../components/ui/Card.jsx';
import { googleRatingOverview, googleReviewRatings } from '../domain/googleReviewPresentation.js';

export function GoogleReviewStars({ rating }) {
  const count = googleReviewRatings[rating];
  return count ? <span role="img" aria-label={`${count} ${count === 1 ? 'star' : 'stars'}`} className="inline-flex shrink-0 items-center gap-0.5 text-amber-600">{Array.from({ length: count }, (_, index) => <Star key={index} size={14} fill="currentColor" aria-hidden="true" />)}</span> : null;
}

export default function GoogleRatingOverview({ context }) {
  const overview = googleRatingOverview(context);
  const state = overview ? 'ready' : 'unavailable';
  return <section aria-label="Google Rating Overview" className="space-y-3">
    <h2 className="text-sm font-bold">Google Rating Overview</h2>
    <div className="grid gap-3 lg:grid-cols-2">
      <AdminSummaryGrid variant="compact" mobileColumns={2} ariaLabel="Location rating summary" items={[
        { key: 'rating', label: 'Overall Rating', value: overview?.average == null ? '—' : `${overview.average.toFixed(1)} / 5`, helper: overview?.source === 'google' ? 'Google rating' : overview ? 'Synced Reviews Average' : 'Sync required', state },
        { key: 'total', label: 'Total Reviews', value: overview?.total ?? '—', helper: overview?.source === 'google' ? 'Google total' : overview ? 'All synced reviews' : 'Complete reviews unavailable', state },
      ]} />
      <Card>
        <div className="space-y-2 px-4 py-3" aria-label="Rating distribution">
          {[5, 4, 3, 2, 1].map(rating => {
            const count = overview?.counts[rating - 1];
            return <div key={rating} className="flex items-center gap-3 text-sm">
              <span className="inline-flex w-9 shrink-0 items-center gap-1" aria-label={`${rating} stars`}>{rating}<Star size={12} fill="currentColor" className="text-amber-600" aria-hidden="true" /></span>
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-muted" role={overview ? 'meter' : undefined} aria-label={overview ? `${rating}-star reviews` : undefined} aria-valuemin={overview ? 0 : undefined} aria-valuemax={overview ? Math.max(1, overview.total) : undefined} aria-valuenow={count}>
                {overview ? <div className="h-full rounded-full bg-amber-500" style={{ width: `${overview.total ? count / overview.total * 100 : 0}%` }} /> : null}
              </div>
              <span className="w-10 shrink-0 text-right tabular-nums text-text-secondary">{count ?? '—'}</span>
            </div>;
          })}
        </div>
      </Card>
    </div>
  </section>;
}
