import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ readLindungSetup: vi.fn() }));
vi.mock('../../../../services/payrollService.js', () => ({ payrollService: mocks }));
import PayrollLindungSetup from '../PayrollLindungSetup.jsx';
const read = { employee: { nationality: 'Malaysia', joined_date: '2026-01-01', legal_entity_id: 'employer' },
 legal_entities: [{ id: 'employer', name: 'QA Employer' }], history: [], current: { status: 'unresolved' }, fingerprint: 'trusted' };
const changed = vi.fn();
const props = { profile: { id: 'profile' }, month: '2026-09-01', onChange: changed, act4Covered: true };
beforeEach(() => { vi.clearAllMocks(); mocks.readLindungSetup.mockResolvedValue(read); });
afterEach(cleanup);
async function choose(label, option) { fireEvent.click(screen.getByRole('button', { name: label, exact: true })); fireEvent.click(screen.getByRole('button', { name: option, exact: true })); }
it('derives Malaysian coverage and emits one routine monthly intent without a separate save or reason', async () => {
 render(<PayrollLindungSetup {...props} />); await screen.findByRole('button', { name: 'LINDUNG coverage status' });
 await choose('LINDUNG coverage status', 'Participating');
 expect(screen.getByText('Malaysian employee')).toBeTruthy();
 expect(screen.queryByRole('button', {name:'Worker coverage'})).toBeNull();
 expect(screen.queryByRole('button', {name:'Confirm LINDUNG Evidence'})).toBeNull();
 expect(screen.queryByLabelText('Confirmation reason')).toBeNull();
 expect(screen.queryByRole('button', {name:'Verified effective date'})).toBeNull();
 expect(screen.getByLabelText('Reference / Notes (optional)')).toBeTruthy();
 await waitFor(()=>expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({allowed:true,month:'2026-09-01',intent:expect.objectContaining({status:'participating',coverage_from:null,worker_category:'local'})})));
});
it('does not copy later evidence into a historical month', async () => {
 mocks.readLindungSetup.mockResolvedValue({...read,current:{status:'participating',evidence:{effective_month:'2026-10-01',designated_legal_entity_id:'employer'}}});
 render(<PayrollLindungSetup {...props} />); await screen.findByRole('button',{name:'LINDUNG coverage status'});
 expect(screen.getByRole('button',{name:'LINDUNG coverage status'}).textContent).toContain('Not Confirmed');
});
it('foreign and June coverage expose system Mandatory without local opt-out', async () => {
 mocks.readLindungSetup.mockResolvedValue({...read,employee:{...read.employee,nationality:'Myanmar'}});
 render(<PayrollLindungSetup {...props} />); await screen.findByRole('button',{name:'LINDUNG coverage status'});
 expect(screen.getByRole('button',{name:'LINDUNG coverage status'}).textContent).toContain('Mandatory');
 fireEvent.click(screen.getByRole('button',{name:'LINDUNG coverage status'}));
 expect(screen.queryByRole('button',{name:'Opted Out',exact:true})).toBeNull();
});
it('opt-out reveals only its required notice/registration evidence', async () => {
 render(<PayrollLindungSetup {...props} />); await screen.findByRole('button',{name:'LINDUNG coverage status'});
 await choose('LINDUNG coverage status','Opted Out');
 expect(screen.getByRole('textbox',{name:'PERKESO opt-out notice date'})).toBeTruthy();
 expect(screen.getByRole('textbox',{name:'New PERKESO registration date'})).toBeTruthy();
 expect(screen.getByLabelText(/PERKESO evidence \/ reference/)).toBeTruthy();
 expect(changed.mock.calls.at(-1)[0].allowed).toBe(false);
});
it('another employer requires a designated employer and reference', async () => {
 render(<PayrollLindungSetup {...props} />); await screen.findByRole('button',{name:'LINDUNG coverage status'});
 await choose('LINDUNG coverage status','Another Employer Pays');
 fireEvent.change(screen.getByLabelText(/Other employer name/),{target:{value:'Other Employer'}});
 fireEvent.change(screen.getByLabelText(/PERKESO evidence \/ reference/),{target:{value:'Verified designation'}});
 await waitFor(()=>expect(changed.mock.calls.at(-1)[0].allowed).toBe(true));
});
it('rejoin retains the legally required submission date/time', async () => {
 mocks.readLindungSetup.mockResolvedValue({...read,current:{status:'valid_opt_out',evidence:{effective_month:'2026-07-01',worker_category:'local'}}});
 render(<PayrollLindungSetup {...props} />); await screen.findByRole('button',{name:'LINDUNG coverage status'});
 await choose('LINDUNG coverage status','Participating');
 expect(screen.getByLabelText(/Submission time \(Malaysia\)/)).toBeTruthy();
 expect(screen.getByLabelText(/PERKESO evidence \/ reference/)).toBeTruthy();
});

it('retains an existing valid opt-out without asking for a new monthly notice', async () => {
 mocks.readLindungSetup.mockResolvedValue({...read,current:{status:'valid_opt_out',evidence:{id:'verified-notice',effective_month:'2026-07-01',worker_category:'local'}}});
 render(<PayrollLindungSetup {...props} />);await screen.findByRole('button',{name:'LINDUNG coverage status'});
 expect(screen.queryByRole('textbox',{name:'PERKESO opt-out notice date'})).toBeNull();
 await waitFor(()=>expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({allowed:true,intent:expect.objectContaining({retained_version_id:'verified-notice',status:'valid_opt_out'})})));
});
