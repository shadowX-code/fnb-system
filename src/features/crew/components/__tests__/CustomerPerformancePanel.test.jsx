import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ context: vi.fn(), save: vi.fn(), history: vi.fn(), preview: vi.fn() }));
vi.mock('../../../../services/crewService.js', () => ({ crewService: { googleReviewsAdminContext: mocks.context, setGoogleMonthlyTarget: mocks.save, googleTargetHistory: mocks.history } }));
vi.mock('../../services/googleBusinessService.js', () => ({ googleBusinessService: { customerPreview: mocks.preview } }));
import CustomerPerformancePanel from '../CustomerPerformancePanel.jsx';
const auth = { hasPermission: () => true };
beforeEach(() => { vi.useRealTimers(); mocks.context.mockReset().mockResolvedValue({ positive_target: 10, target_locked: false }); mocks.save.mockReset().mockResolvedValue({ positive_target: 15 }); mocks.history.mockReset().mockResolvedValue({ rows: [] }); mocks.preview.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const mount = (props = {}) => render(<CustomerPerformancePanel outletId="outlet-1" period="2026-10-01" auth={auth} onPreview={vi.fn()} {...props} />);
describe('Customer configuration and transient preview', () => {
 it('restores monthly configuration through the existing setter and preserves failed edits', async () => {
  mount(); const input = screen.getByLabelText('Monthly Positive Review Target');
  await waitFor(() => expect(input.value).toBe('10'));
  fireEvent.change(input, { target: { value: '15' } });
  mocks.save.mockRejectedValueOnce(new Error('Target locked by another reviewer'));
  fireEvent.click(screen.getByRole('button', { name: 'Save Target' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Target locked by another reviewer');
  expect(input.value).toBe('15');
  fireEvent.click(screen.getByRole('button', { name: 'Save Target' }));
  expect(await screen.findByText('Monthly target saved.')).not.toBeNull();
  expect(mocks.save).toHaveBeenLastCalledWith('outlet-1', '2026-10-01', 15);
 });
 it('shows a complete breakdown without adding a finalization action', async () => {
  mocks.preview.mockResolvedValue({ status: 'preview_only', score: 17, positiveTarget: 12, quality: 5, positive: 8, target: 10, negative: 0, total: 10, negativeRate: 0, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+300000).toISOString() });
  mount(); await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh Customer Preview' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Customer Preview' }));
  expect(await screen.findByText('Customer: 17 / 20 · Preview')).not.toBeNull();
  expect(screen.getByText('8 / 10 positive reviews · 12 / 15 points')).not.toBeNull();
  expect(screen.getByText('0 negative / 10 reviews · 0% · 5 / 5 points')).not.toBeNull();
  expect(screen.queryByRole('button', { name: /Finalize/ })).toBeNull();
 });
 it.each(['incomplete_evidence', 'evidence_expired', 'reconnect_required'])('keeps %s Pending', async reason => {
  mocks.preview.mockResolvedValue({ status: 'pending', score: null, reason }); mount();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh Customer Preview' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Customer Preview' }));
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledWith('outlet-1', '2026-10-01'));
  expect(await screen.findByText('Customer: Pending')).not.toBeNull();
  expect(screen.queryByText(/Customer: 0/)).toBeNull();
 });
 it('requires Google permissions separately and respects finalized target lock', async () => {
  mocks.context.mockResolvedValue({ positive_target: 10, target_locked: true });
  mount({ auth: { hasPermission: key => key === 'crew_performance.review' } });
  expect(await screen.findByText('Target locked after Performance finalization.')).not.toBeNull();
  expect(screen.getByLabelText('Monthly Positive Review Target').disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Refresh Customer Preview' })).toBeNull();
 });
 it('discards a previous outlet result rather than leaking it into a newly selected outlet', async () => {
  let resolve; mocks.preview.mockImplementation(() => new Promise(done => { resolve = done; }));
  const onPreview = vi.fn(); const view = mount({ onPreview });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh Customer Preview' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Customer Preview' }));
  view.rerender(<CustomerPerformancePanel outletId="outlet-2" period="2026-10-01" auth={auth} onPreview={onPreview} />);
  resolve({ status: 'preview_only', score: 20 });
  await waitFor(() => expect(mocks.context).toHaveBeenCalledWith('outlet-2', '2026-10-01'));
  expect(onPreview).not.toHaveBeenCalledWith(expect.objectContaining({ score: 20 }));
 });
});
