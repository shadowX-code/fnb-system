import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ readLindungSetup: vi.fn(), confirmLindungSetup: vi.fn() }));
vi.mock('../../../../services/payrollService.js', () => ({ payrollService: mocks }));
import PayrollLindungSetup from '../PayrollLindungSetup.jsx';
import { payrollIssueLabel } from '../payrollRunPresentation.js';
const read = { employee: { nationality: 'Malaysia', joined_date: '2026-01-01', legal_entity_id: 'employer' },
  legal_entities: [{ id: 'employer', name: 'QA Employer' }], history: [], current: { status: 'unresolved' }, fingerprint: 'trusted' };
const props = { profile: { id: 'profile' }, month: '2026-09-01', onSaved: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); mocks.readLindungSetup.mockResolvedValue(read); mocks.confirmLindungSetup.mockResolvedValue(read); });
afterEach(cleanup);
async function choose(label, option) {
  fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
  fireEvent.click(screen.getByRole('button', { name: option, exact: true }));
}
it('requires explicit participation/evidence and sends the independent authority intent', async () => {
  render(<PayrollLindungSetup {...props} />);
  await screen.findByRole('button', { name: 'LINDUNG coverage status' });
  await choose('LINDUNG coverage status', 'Participating');
  expect(screen.getByRole('button', { name: 'Confirm LINDUNG Evidence' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('switch', { name: /Act 4-covered employment verified/ }));
  fireEvent.change(screen.getByRole('textbox', { name: /PERKESO evidence/ }), { target: { value: 'ASSIST verified September' } });
  fireEvent.change(screen.getByRole('textbox', { name: /Confirmation reason/ }), { target: { value: 'Confirm known enrollment' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm LINDUNG Evidence' }));
  await waitFor(() => expect(mocks.confirmLindungSetup).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'profile', fingerprint: 'trusted',
    intent: expect.objectContaining({ effective_month: '2026-09-01', coverage_from: '2026-09-01T00:00:00+08:00',
      status: 'participating', designated_legal_entity_id: 'employer', act4_covered: true, participation_basis: 'default_enrolment' }) })));
});
it('does not copy current enrollment into a historical month or retain an edited prior-month draft', async () => {
  mocks.readLindungSetup.mockResolvedValue({ ...read, current: { status: 'participating', effective_from: '2026-10-01' } });
  const { rerender } = render(<PayrollLindungSetup {...props} month="2026-10-01" />);
  await screen.findByRole('button', { name: 'LINDUNG coverage status' });
  await choose('LINDUNG coverage status', 'Participating');
  fireEvent.change(screen.getByRole('textbox', { name: /PERKESO evidence/ }), { target: { value: 'October evidence only' } });
  mocks.readLindungSetup.mockResolvedValue(read);
  rerender(<PayrollLindungSetup {...props} />);
  await waitFor(() => expect(mocks.readLindungSetup).toHaveBeenLastCalledWith('profile', '2026-09-01'));
  expect(screen.getByRole('button', { name: 'LINDUNG coverage status' }).textContent).toContain('Unresolved');
  expect(screen.getByRole('textbox', { name: /PERKESO evidence/ }).value).toBe('');
});
it('foreign employees have Mandatory and no local opt-out selection', async () => {
  mocks.readLindungSetup.mockResolvedValue({ ...read, employee: { ...read.employee, nationality: 'Myanmar' } });
  render(<PayrollLindungSetup {...props} />);
  await screen.findByRole('button', { name: 'LINDUNG coverage status' });
  fireEvent.click(screen.getByRole('button', { name: 'LINDUNG coverage status' }));
  expect(screen.getByRole('button', { name: 'Mandatory', exact: true })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Valid Opt-Out', exact: true })).toBeNull();
});
it('June exposes mandatory treatment; rejoin exposes the submission time separately', async () => {
  const { rerender } = render(<PayrollLindungSetup {...props} month="2026-06-01" />);
  await screen.findByText(/June 2026 contributions were mandatory/);
  await screen.findByRole('button', { name: 'LINDUNG coverage status' });
  fireEvent.click(screen.getByRole('button', { name: 'LINDUNG coverage status' }));
  expect(screen.queryByRole('button', { name: 'Participating', exact: true })).toBeNull();
  rerender(<PayrollLindungSetup {...props} />);
  await screen.findByRole('button', { name: 'LINDUNG coverage status' });
  await choose('LINDUNG coverage status', 'Participating');
  await choose('Participation evidence', 'Rejoined after a recorded opt-out');
  expect(screen.getByLabelText(/Submission time \(Malaysia\)/)).toBeTruthy();
  expect(screen.getByText(/full month's contributable wages/)).toBeTruthy();
});
it('Review reasons name the period and distinguish missing employer/pack', () => {
  expect(payrollIssueLabel('lindung_participation_unconfirmed:2026-09-01')).toContain('September 2026 LINDUNG participation is unconfirmed');
  expect(payrollIssueLabel('lindung_designated_employer_missing')).toContain('Designated contributing employer is missing');
  expect(payrollIssueLabel('lindung_rate_pack_unavailable')).toContain('LINDUNG rate pack unavailable');
});
