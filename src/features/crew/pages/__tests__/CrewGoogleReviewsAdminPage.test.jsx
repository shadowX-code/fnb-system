import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ context: vi.fn(), sync: vi.fn(), map: vi.fn(), authorize: vi.fn(), disconnect: vi.fn(), discover: vi.fn(), legacy: vi.fn(), save: vi.fn(), history: vi.fn() }));
vi.mock('../../services/googleBusinessService.js', () => ({ googleBusinessService: mocks }));
vi.mock('../../../../services/crewService.js', () => ({ crewService: { googleReviewsAdminContext: mocks.legacy, setGoogleMonthlyTarget: mocks.save, googleTargetHistory: mocks.history } }));
import CrewGoogleReviewsAdminPage from '../CrewGoogleReviewsAdminPage.jsx';
import GoogleReviewTargetSettings from '../../components/GoogleReviewTargetSettings.jsx';
const outlet = { id: 'outlet-1', name: 'Friends Corner', is_active: true };
const secondOutlet = { id: 'outlet-2', name: 'JYMT', is_active: true };
const context = { configured: true, connection_status: 'disconnected', can_manage: true, generation: 0, reviews: [], sync_status: 'awaiting_sync', scoring_enabled: false };
const mapping = { name: 'accounts/a/locations/l', title: 'Fixture location', revision: 'revision-1' };
const connected = { ...context, connection_status: 'connected', generation: 2, accounts: [{ displayName: 'Fixture account' }], locations: [{ name: mapping.name, title: mapping.title }, { name: 'accounts/a/locations/other', title: 'Other location' }], mapping };
const reviews = [
  { name: 'accounts/a/locations/l/reviews/1', starRating: 'FIVE', createTime: '2026-10-01T00:00:00Z', updateTime: '2026-10-01T00:00:00Z', comment: 'Excellent fixture', reviewer: { displayName: 'Test reviewer' }, reviewReply: { comment: 'Thank you fixture', updateTime: '2026-10-02T00:00:00Z' } },
  { name: 'accounts/a/locations/l/reviews/2', starRating: 'TWO', createTime: '2026-10-01T00:00:00Z', updateTime: '2026-10-01T00:00:00Z', comment: 'Other fixture' },
];
const complete = { ...connected, sync_status: 'complete', cache_expires_at: new Date(Date.now() + 3600000).toISOString(), reviews };
const mount = (outlets = [outlet]) => render(<CrewGoogleReviewsAdminPage store={{ outlets }} />);
const settings = () => fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.context.mockResolvedValue(context); mocks.legacy.mockResolvedValue({ positive_target: null, target_locked: false });
  mocks.history.mockResolvedValue({ rows: [] }); mocks.save.mockResolvedValue({ changed: true }); mocks.sync.mockResolvedValue({ ok: true });
});
afterEach(cleanup);
describe('Google Reviews Inbox and Settings', () => {
  it('shows disconnected guidance without fabricated metrics, targets or success banners', async () => {
    mount(); await screen.findByText('Google Business Profile is not connected');
    expect(screen.getByRole('button', { name: 'Sync reviews' }).disabled).toBe(true);
    expect(screen.queryByText('Average Rating')).toBeNull(); settings();
    expect(screen.getByRole('button', { name: 'Connect Google' }).disabled).toBe(false);
    expect(screen.queryByText('Monthly Positive Review Target')).toBeNull();
    expect(mocks.legacy).not.toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled();
  });
  it('keeps connection and mapping mutations unavailable to read-only users', async () => {
    mocks.context.mockResolvedValue({ ...context, can_manage: false }); mount(); await screen.findByText('Google Business Profile is not connected'); settings();
    expect(screen.getByRole('button', { name: 'Connect Google' }).disabled).toBe(true);
    expect((await screen.findByRole('button', { name: 'Edit mapping for Friends Corner' })).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Manage Connection' })).toBeNull();
  });
  it('places secondary connection actions in the shared menu and requires Disconnect confirmation', async () => {
    mocks.context.mockResolvedValue(connected); mount(); await screen.findByText('Ready to sync'); settings();
    expect(screen.getByText('Fixture account')).not.toBeNull(); expect(screen.getByText('2 locations')).not.toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Reconnect' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Manage Connection' }));
    expect(screen.getByRole('menuitem', { name: 'Refresh Locations' })).not.toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disconnect' }));
    expect(mocks.disconnect).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Disconnect Google Business Profile' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })); expect(mocks.disconnect).not.toHaveBeenCalled();
  });
  it('prevents duplicate confirmed disconnects and retains an actionable revocation error', async () => {
    mocks.context.mockResolvedValue(connected);
    let reject;
    mocks.disconnect.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    mount(); await screen.findByText('Ready to sync'); settings();
    fireEvent.click(screen.getByRole('button', { name: 'Manage Connection' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disconnect' }));
    const dialog = screen.getByRole('dialog', { name: 'Disconnect Google Business Profile' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect', exact: true }));
    expect(within(dialog).getByRole('button', { name: 'Disconnecting…' }).disabled).toBe(true);
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    reject(new Error('Google revoke failed. Retry disconnect.'));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Retry disconnect');
  });
  it('lists explicit multi-outlet mappings without guessing matching names', async () => {
    mocks.context.mockImplementation(id => Promise.resolve(id === outlet.id ? connected : { ...connected, mapping: null }));
    mount([outlet, secondOutlet]); await screen.findByText('Ready to sync'); settings();
    await screen.findByText('Unmapped');
    const table = screen.getByRole('table'); expect(within(table).getByText('Friends Corner')).not.toBeNull();
    expect(within(table).getByText('JYMT')).not.toBeNull(); expect(within(table).getByText('Mapped')).not.toBeNull();
    expect(mocks.map).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Edit mapping for JYMT' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Outlet Mapping' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save mapping' }).disabled).toBe(true));
    expect(within(dialog).getByText('Unmapped')).not.toBeNull();
  });
  it('uses the edited outlet and fresh generation/revision, retaining selection after stale rejection', async () => {
    const second = { ...connected, mapping: { ...mapping, revision: 'fresh-revision' } };
    mocks.context.mockImplementation(id => Promise.resolve(id === outlet.id ? connected : second));
    mocks.map.mockRejectedValue(new Error('Mapping changed. Refresh Settings.'));
    mount([outlet, secondOutlet]); await screen.findByText('Ready to sync'); settings();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit mapping for JYMT' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Outlet Mapping' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Google Location' }));
    fireEvent.click(screen.getByRole('option', { name: 'Other location' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save mapping' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Mapping changed');
    expect(within(dialog).getByRole('button', { name: 'Google Location' }).textContent).toContain('Other location');
    expect(mocks.map).toHaveBeenCalledWith(secondOutlet.id, 'accounts/a/locations/other', expect.objectContaining({ generation: 2, mapping: expect.objectContaining({ revision: 'fresh-revision' }) }));
  });
  it('marks failed mapping reads as unavailable and prevents editing instead of reporting Unmapped', async () => {
    mocks.context.mockImplementation(id => id === outlet.id ? Promise.resolve(connected) : Promise.reject(new Error('Not authorized')));
    mount([outlet, secondOutlet]); await screen.findByText('Ready to sync'); settings();
    expect(await screen.findByText('Unable to load')).not.toBeNull(); expect(screen.queryByText('Unmapped')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit mapping for JYMT' }).disabled).toBe(true);
  });
  it('renders existing owner replies and applies shared search/reply filters', async () => {
    mocks.context.mockResolvedValue(complete); mount(); await screen.findByText('Thank you fixture');
    expect(screen.getByText('Google', { exact: true })).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Thank you' } }); expect(screen.queryByText('Other fixture')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'More filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Owner reply', exact: true })); fireEvent.click(screen.getByRole('option', { name: 'Without owner reply' }));
    expect(screen.queryByText('Thank you fixture')).toBeNull(); expect(screen.getByText('Other fixture')).not.toBeNull();
  });
  it('keeps location-wide rating totals independent of Inbox filtering', async () => {
    mocks.context.mockResolvedValue({ ...complete, google_aggregate: { location: mapping.name, totalReviewCount: 2, averageRating: 3.5 } });
    mount(); await screen.findByText('Excellent fixture');
    const overview = screen.getByRole('region', { name: 'Google Rating Overview' });
    expect(within(overview).getByText('3.5 / 5')).not.toBeNull();
    expect(within(overview).getByRole('meter', { name: '5-star reviews' }).getAttribute('aria-valuenow')).toBe('1');
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'unmatched' } });
    expect(screen.getByText('No reviews match these filters')).not.toBeNull();
    expect(within(overview).getByText('3.5 / 5')).not.toBeNull();
    expect(within(overview).getByRole('meter', { name: '2-star reviews' }).getAttribute('aria-valuenow')).toBe('1');
  });
  it('reports empty results truthfully and clears filters', async () => {
    mocks.context.mockResolvedValue(complete); mount(); await screen.findByText('Excellent fixture');
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'unmatched' } });
    expect(screen.getByText('No reviews match these filters')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' })); expect(screen.getByText('Excellent fixture')).not.toBeNull();
  });
  it('surfaces the exact failed sync request without automatic provider retries or a false success banner', async () => {
    mocks.context.mockResolvedValueOnce(complete).mockResolvedValue({ ...connected, sync_status: 'error' });
    mocks.sync.mockRejectedValue(new Error('Google rate limit (429): mybusiness.googleapis.com · GET /v4/accounts/a/locations/l/reviews.'));
    mount(); await screen.findByText('Excellent fixture'); fireEvent.click(screen.getByRole('button', { name: 'Sync reviews' }));
    expect((await screen.findByRole('alert')).textContent).toContain('mybusiness.googleapis.com');
    await screen.findByText('Review sync needs attention'); expect(screen.queryByText('Excellent fixture')).toBeNull();
    expect(mocks.sync).toHaveBeenCalledTimes(1); expect(mocks.context).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Google review sync complete.')).toBeNull();
  });
  it('clears the previous outlet reviews immediately while a new outlet read is pending', async () => {
    mocks.context.mockImplementation(id => id === outlet.id ? Promise.resolve(complete) : new Promise(() => {}));
    mount([outlet, secondOutlet]); await screen.findByText('Excellent fixture');
    fireEvent.click(screen.getByRole('button', { name: 'Outlet', exact: true })); fireEvent.click(screen.getByRole('option', { name: 'JYMT', exact: true }));
    expect(screen.queryByText('Excellent fixture')).toBeNull(); expect(screen.getByRole('status', { name: 'Loading Google Reviews' })).not.toBeNull();
  });
  it('invalidates selected-outlet reviews after an explicit mapping change', async () => {
    mocks.context.mockResolvedValue(complete); mocks.map.mockImplementation(async () => { mocks.context.mockResolvedValue({ ...connected, mapping: null, reviews: [], sync_status: 'awaiting_sync' }); });
    mount(); await screen.findByText('Excellent fixture'); settings();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit mapping for Friends Corner' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Outlet Mapping' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Google Location' })); fireEvent.click(screen.getByRole('option', { name: 'Unmapped' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save mapping' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('tab', { name: 'Review Inbox' })); expect(screen.queryByText('Excellent fixture')).toBeNull();
    expect(screen.getByText('No Google Location mapped')).not.toBeNull(); expect(mocks.map).toHaveBeenCalledTimes(1);
  });
  it('preserves the existing target component and audited authority outside normal Google Settings', async () => {
    mocks.history.mockResolvedValue({ rows: [{ id: 1, old_target: 10, new_target: 15, changed_at: '2026-09-01T00:00:00Z' }] });
    render(<GoogleReviewTargetSettings outletId={outlet.id} canEdit />); await screen.findByText('10 → 15 positive reviews');
    fireEvent.change(screen.getByLabelText('Positive reviews'), { target: { value: '3' } }); fireEvent.click(screen.getByRole('button', { name: 'Save target' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(outlet.id, expect.stringMatching(/^\d{4}-\d{2}-01$/), 3));
  });
});
