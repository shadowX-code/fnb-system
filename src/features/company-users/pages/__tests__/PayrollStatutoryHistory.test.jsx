import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ readStatutorySetup: vi.fn(), readLindungSetup: vi.fn() }));
vi.mock('../../../../services/payrollService.js', () => ({ payrollService: mocks }));
import History, { readStatutoryHistory, statutoryHistoryDates } from '../PayrollStatutoryHistory.jsx';
const history = { applicability: [{ id:'a', effective_from:'2026-07-01', reason:'Admin coverage' }], categories: [{ id:'c', effective_from:'2026-09-01', reason:'Verified category' }] };
const lindung = [{ id:'u', effective_month:'2026-10-01', status:'unresolved', resolution_role:'unconfirmed_observation' }, { id:'l', effective_month:'2026-07-01', status:'not_applicable' }];
beforeEach(() => {
 vi.clearAllMocks();
 mocks.readStatutorySetup.mockImplementation(async (_profile,date)=>({history, schemes:{epf:{state:'confirmed',category:date==='2026-07-01'?'malaysian_under_60':'malaysian_60_to_74'},socso:{state:'not_applicable'},eis:{state:'not_applicable'},pcb:{state:'confirmed'}}}));
 mocks.readLindungSetup.mockResolvedValue({history:lindung,current:{status:'not_applicable'}});
});
afterEach(cleanup);
it('composes interleaved authorities chronologically using canonical date reads, without draft applicability',async()=>{
 const rows=await readStatutoryHistory('p');
 expect(rows.map(row=>row.date)).toEqual(['2026-07-01','2026-09-01','2026-10-01']);
 expect(rows[0].schemes.epf.category).toBe('malaysian_under_60');
 expect(rows[1].schemes.epf.category).toBe('malaysian_60_to_74');
 expect(rows[2].schemes.lindung.status).toBe('not_applicable');
 expect(rows[2].evidence[0].status).toBe('unresolved');
 for(const date of rows.map(row=>row.date)) {
  expect(mocks.readStatutorySetup).toHaveBeenCalledWith('p',date);
  expect(mocks.readLindungSetup).toHaveBeenCalledWith('p',date);
 }
});
it('includes expiry/scheme/June local election boundaries without inventing monthly revisions',()=>{
 expect(statutoryHistoryDates({applicability:[{effective_from:'2026-01-01'}],categories:[{effective_from:'2026-07-01',effective_to:'2026-08-31'}]},[{effective_month:'2026-06-01',status:'mandatory',worker_category:'local'}])).toEqual(['2026-01-01','2026-06-01','2026-07-01','2026-09-01']);
 expect(statutoryHistoryDates({applicability:[],categories:[]},[{effective_month:'2026-07-01',status:'not_applicable'}])).toEqual(['2026-07-01']);
});
it('shows all five resolved components and retains audit-only observations in one history',async()=>{
 render(<History profileId="p"/>);
 expect(mocks.readStatutorySetup).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('Statutory History'));
 await screen.findByText('Coverage resolved at each effective date. Finalized Payroll evidence stays unchanged.');
 expect(screen.getAllByText('LINDUNG 24 Jam')).toHaveLength(3);
 expect(screen.getAllByText('PCB / MTD')).toHaveLength(3);
 expect(screen.getByText(/Not Confirmed observation/)).toBeTruthy();
 expect(screen.queryByText('LINDUNG history')).toBeNull();
});
it('read failure remains explicit instead of showing a guessed or partial timeline',async()=>{
 mocks.readLindungSetup.mockRejectedValue(new Error('History unavailable'));
 render(<History profileId="p"/>);fireEvent.click(screen.getByText('Statutory History'));
 await screen.findByRole('alert');
 expect(screen.getByText('History unavailable')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Retry history'})).toBeTruthy();
 expect(screen.queryByText('No statutory revisions recorded.')).toBeNull();
});
