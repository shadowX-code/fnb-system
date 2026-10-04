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

const decision = {id:'time',runId:'run',requestId:'request',action:'adjust',approvedMinutes:300,extraMinutes:0,classification:'regular',reason:'Verified evidence'};
it('recovers a response lost after commit through audited request read-back', async () => {
 const saved={id:'committed',row:{id:'committed',status:'approved_manual'}};
 rpc.mockResolvedValueOnce({error:{message:'Network request failed'}}).mockResolvedValueOnce({data:saved,error:null});
 expect(await payrollService.decideTime(decision)).toEqual(saved);
 expect(rpc.mock.calls.map(([name])=>name)).toEqual(['payroll_time_decision_save','payroll_time_decision_status']);
 expect(rpc.mock.calls[0][1]).toEqual(rpc.mock.calls[1][1]);
});
it('replays exactly the same request when a lost response has no committed audit yet', async () => {
 rpc.mockResolvedValueOnce({error:{message:'Failed to fetch'}}).mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:{id:'saved'},error:null});
 await payrollService.decideTime(decision);
 expect(rpc.mock.calls.map(([name])=>name)).toEqual(['payroll_time_decision_save','payroll_time_decision_status','payroll_time_decision_save']);
 expect(rpc.mock.calls[0][1]).toEqual(rpc.mock.calls[2][1]);
});
it('states SQL cancellation did not save and keeps ambiguous transport failures distinct', async () => {
 rpc.mockResolvedValueOnce({error:{code:'57014',message:'statement timeout'}});
 await expect(payrollService.decideTime(decision)).rejects.toThrow('Decision was not saved');
 expect(rpc).toHaveBeenCalledTimes(1);
 rpc.mockResolvedValue({error:{message:'Network unavailable'}});
 await expect(payrollService.decideTime(decision)).rejects.toMatchObject({saveUncertain:true});
});
