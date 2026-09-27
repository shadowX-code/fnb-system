import { beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }));
import { payrollService } from '../payrollService.js';
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: {}, error: null }); });
it('recalculates earnings before statutory results without confirming PCB', async () => {
  await payrollService.recalculateRun('run');
  expect(rpc.mock.calls.map(([name]) => name)).toEqual(['payroll_run_calculate','payroll_run_statutory_calculate']);
});
it('does not continue statutory calculation after an earnings failure', async () => {
  rpc.mockResolvedValueOnce({ error: { message: 'Denied' } });
  await expect(payrollService.recalculateRun('run')).rejects.toThrow();
  expect(rpc).toHaveBeenCalledTimes(1);
});
it.each([['draft',['review_required','ready','finalized']],['review_required',['ready','finalized']],['ready',['finalized']]])('finalizes %s through the existing validated transitions', async (status, expected) => {
  await payrollService.finalizeRun('run',status,'Reviewed payroll');
  expect(rpc.mock.calls.map(([, args]) => args.p_next_status)).toEqual(expected);
});
it('stops finalization when the server rejects readiness', async () => {
  rpc.mockResolvedValueOnce({ data: {}, error: null }).mockResolvedValueOnce({ error: {message:'Evidence stale'} });
  await expect(payrollService.finalizeRun('run','draft','Reviewed')).rejects.toThrow();
  expect(rpc).toHaveBeenCalledTimes(2);
});
