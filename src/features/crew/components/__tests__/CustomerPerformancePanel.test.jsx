import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  mount(); await screen.findByText('10 positive reviews');
  expect(screen.queryByLabelText('Monthly Positive Review Target')).toBeNull();
  fireEvent.click(screen.getByRole('button', {name:'Edit', exact:true}));
  const input = screen.getByLabelText('Monthly Positive Review Target');
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
  mount(); await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh Preview' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Preview' }));
  expect(await screen.findByText('17 / 20')).not.toBeNull();
  expect(screen.getByText('8 / 10 positive reviews')).not.toBeNull();
  expect(screen.getByText('8 positive · 2 neutral · 0 negative')).not.toBeNull();
  expect(screen.queryByRole('button', { name: /Finalize/ })).toBeNull();
 });
 it.each(['incomplete_evidence', 'evidence_expired', 'reconnect_required'])('keeps %s Pending', async reason => {
  mocks.preview.mockResolvedValue({ status: 'pending', score: null, reason }); mount();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh Preview' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Preview' }));
  await waitFor(() => expect(mocks.preview).toHaveBeenCalledWith('outlet-1', '2026-10-01'));
  expect(await screen.findByText('Pending')).not.toBeNull();
  expect(screen.queryByText(/Customer: 0/)).toBeNull();
 });
 it('requires Google permissions separately and respects finalized target lock', async () => {
  mocks.context.mockResolvedValue({ positive_target: 10, target_locked: true });
  mount({ auth: { hasPermission: key => key === 'crew_performance.review' } });
  expect(await screen.findByText('Target locked after Performance finalization.')).not.toBeNull();
  expect(screen.queryByLabelText('Monthly Positive Review Target')).toBeNull();
  expect(screen.getByRole('button',{name:'Edit',exact:true}).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Refresh Preview' })).toBeNull();
 });
 it('discards a previous outlet result rather than leaking it into a newly selected outlet', async () => {
  let resolve; mocks.preview.mockImplementation(() => new Promise(done => { resolve = done; }));
  const onPreview = vi.fn(); const view = mount({ onPreview });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh Preview' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Preview' }));
  view.rerender(<CustomerPerformancePanel outletId="outlet-2" period="2026-10-01" auth={auth} onPreview={onPreview} />);
  resolve({ status: 'preview_only', score: 20 });
  await waitFor(() => expect(mocks.context).toHaveBeenCalledWith('outlet-2', '2026-10-01'));
  expect(onPreview).not.toHaveBeenCalledWith(expect.objectContaining({ score: 20 }));
 });
});


it('clears expired numeric scores and breakdown without persisting a replacement', async () => {
 vi.useFakeTimers(); const onPreview = vi.fn();
 mocks.preview.mockResolvedValue({ status:'preview_only', score:9.5, positiveTarget:4.5, quality:5, positive:3, target:10, negative:0, total:4, negativeRate:0, fetchedAt:new Date().toISOString(), expiresAt:new Date(Date.now()+300000).toISOString() });
 mount({onPreview}); await act(async () => {});
 fireEvent.click(screen.getByRole('button',{name:'Refresh Preview'})); await act(async () => {});
 expect(screen.getByText('9.5 / 20')).not.toBeNull();
 await act(async () => {vi.advanceTimersByTime(300000);});
 expect(screen.getByText('Pending')).not.toBeNull();
 expect(screen.queryByText('9.5 / 20')).toBeNull();
 expect(screen.queryByText('3 positive · 1 neutral · 0 negative')).toBeNull();
 expect(onPreview).toHaveBeenLastCalledWith(null);
 expect(mocks.save).not.toHaveBeenCalled();
});
