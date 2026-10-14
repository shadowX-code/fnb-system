import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import GoogleRatingOverview, { GoogleReviewStars } from '../../components/GoogleRatingOverview.jsx';
afterEach(cleanup);
describe('Google rating presentation', () => {
  it.each([['ONE', 1], ['TWO', 2], ['THREE', 3], ['FOUR', 4], ['FIVE', 5]])('renders %s as exactly %i filled stars', (rating, count) => {
    const { container } = render(<GoogleReviewStars rating={rating} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(`${count} ${count === 1 ? 'star' : 'stars'}`);
    expect(container.querySelectorAll('svg')).toHaveLength(count);
    expect([...container.querySelectorAll('svg')].every(icon => icon.getAttribute('fill') === 'currentColor')).toBe(true);
    expect(container.textContent).toBe('');
  });
  it('uses shared KPIs and five distribution bars for complete evidence, showing no numbers when expired', () => {
    const context = { connection_status: 'connected', mapping: { name: 'accounts/a/locations/l' }, sync_status: 'complete', cache_expires_at: new Date(Date.now() + 60000).toISOString(), reviews: [{ name: 'accounts/a/locations/l/reviews/1', starRating: 'FOUR' }] };
    const { rerender } = render(<GoogleRatingOverview context={context} />);
    expect(screen.getByText('4.0 / 5')).not.toBeNull(); expect(screen.getByText('Synced Reviews Average')).not.toBeNull();
    expect(screen.getAllByRole('meter')).toHaveLength(5); expect(screen.getByRole('meter', { name: '4-star reviews' }).getAttribute('aria-valuenow')).toBe('1');
    rerender(<GoogleRatingOverview context={{ ...context, cache_expires_at: new Date(Date.now() - 1).toISOString() }} />);
    expect(screen.queryByText('4.0 / 5')).toBeNull(); expect(screen.queryAllByRole('meter')).toHaveLength(0);
  });
});
