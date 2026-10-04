import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { payrollReviewRows, payrollReviewSummary } from "../payrollRunPresentation.js";
const mocks = vi.hoisted(() => ({ readPreparation: vi.fn(), readCalculation: vi.fn(), readStatutory: vi.fn(), recalculateEmployee: vi.fn(), readFinalizedRecord:vi.fn() }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: mocks }));
import { usePayrollRunRead } from "../usePayrollRunRead.js";
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };

it("ignores old Run success and failure after scope changes", async () => {
  const old = deferred();
  mocks.readPreparation.mockImplementation(id => id === "old" ? old.promise : Promise.resolve({results: [{employee_id:id}]}));
  mocks.readCalculation.mockResolvedValue({results: []}); mocks.readStatutory.mockResolvedValue({results: []});
  const {result,rerender} = renderHook(({id}) => usePayrollRunRead({id,status:"draft"}, null), {initialProps:{id:"old"}});
  rerender({id:"new"});
  await waitFor(() => expect(result.current.data?.preparation.results[0].employee_id).toBe("new"));
  await act(async () => { old.resolve({results:[{employee_id:"old"}]}); });
  expect(result.current.data.preparation.results[0].employee_id).toBe("new");
  const staleFailure = deferred(); mocks.readPreparation.mockReturnValueOnce(staleFailure.promise);
  rerender({id:"failing"}); rerender({id:"latest"});
  await waitFor(() => expect(result.current.data?.preparation.results[0].employee_id).toBe("latest"));
  await act(async () => { staleFailure.reject(new Error("old error")); });
  expect(result.current.error).toBeNull();
});

it("shares readiness/totals without inventing unresolved money or including employer shares in deductions", () => {
  const evidence={preparation:{results:[{employee_id:"one",projection:{status:"ready"},statutory_setup:{complete:true}}]},
    calculation:{results:[{employee_id:"one",status:"ready",gross_earnings:2000}]},
    statutory:{results:[{employee_id:"one",status:"ready",net_pay:1750,total_employer_cost:2300,non_statutory_deductions:30,lines:[{employee_amount:220,employer_amount:300}]}]}};
  expect(payrollReviewSummary(payrollReviewRows(evidence))).toMatchObject({employeeCount:1,readyCount:1,needCount:0,gross:2000,deductions:250,net:1750,employerCost:2300});
  evidence.statutory.results[0].is_stale=true;
  expect(payrollReviewSummary(payrollReviewRows(evidence))).toMatchObject({readyCount:0,needCount:1,deductions:null,net:null,employerCost:null});
  expect(payrollReviewSummary([]).net).toBeNull();
});


it('automatically calculates only missing/stale members, retains unresolved readiness and retries failure explicitly', async () => {
  const preparation={results:[{employee_id:'stale'},{employee_id:'missing'},{employee_id:'unresolved'},{employee_id:'current'}]};
  let refreshed=false;
  mocks.readPreparation.mockResolvedValue(preparation);
  mocks.readCalculation.mockImplementation(async()=>({results:[{employee_id:'stale',is_stale:!refreshed},...(refreshed?[{employee_id:'missing'}]:[]),{employee_id:'unresolved',status:'review_required',is_stale:false},{employee_id:'current',status:'ready',is_stale:false}]}));
  mocks.readStatutory.mockImplementation(async()=>({results:[{employee_id:'stale',is_stale:!refreshed},...(refreshed?[{employee_id:'missing'}]:[]),{employee_id:'unresolved',status:'review_required',is_stale:false},{employee_id:'current',is_stale:false}]}));
  mocks.recalculateEmployee.mockImplementation(async(run,id)=>{if(id==='missing')refreshed=true;});
  const {result}=renderHook(()=>usePayrollRunRead({id:'run',status:'draft'},null,true,true));
  await waitFor(()=>expect(result.current.calculating).toBe(false));
  expect(mocks.recalculateEmployee.mock.calls.map(call=>call[1])).toEqual(['stale','missing']);
  await act(()=>result.current.refresh());
  expect(mocks.recalculateEmployee).toHaveBeenCalledTimes(2);
  refreshed=false;
  mocks.recalculateEmployee.mockRejectedValue(new Error('Calculation unavailable'));
  await act(()=>result.current.refresh());
  expect(result.current.calculationErrors.stale).toBe('Calculation unavailable');
  const count=mocks.recalculateEmployee.mock.calls.length;
  await act(()=>result.current.refresh());
  expect(mocks.recalculateEmployee).toHaveBeenCalledTimes(count);
  mocks.recalculateEmployee.mockImplementation(async()=>{refreshed=true;});
  await act(()=>result.current.retryCalculation('stale'));
  expect(result.current.calculationErrors).toEqual({});
});

it('never automatically mutates finalized/paid/ready runs or view-only accounts',async()=>{
  mocks.readPreparation.mockResolvedValue({results:[{employee_id:'one'}]});
  mocks.readCalculation.mockResolvedValue({results:[]});mocks.readStatutory.mockResolvedValue({results:[]});
  mocks.readFinalizedRecord.mockResolvedValue({results:[{employee_id:'frozen'}]});
  const {result,rerender}=renderHook(({status,manage})=>usePayrollRunRead({id:'run',status},null,true,manage),{initialProps:{status:'finalized',manage:true}});
  await waitFor(()=>expect(result.current.data?.results[0].employee_id).toBe('frozen'));
  rerender({status:'paid',manage:true});
  await waitFor(()=>expect(mocks.readFinalizedRecord).toHaveBeenCalledTimes(2));
  rerender({status:'ready',manage:true});
  await waitFor(()=>expect(result.current.data?.preparation).toBeTruthy());
  rerender({status:'draft',manage:false});
  await act(()=>result.current.refresh());
  expect(mocks.recalculateEmployee).not.toHaveBeenCalled();
});

it('deduplicates overlapping refreshes and observes canonical input changes on focus',async()=>{
  const work=deferred(); let stale=true;
  mocks.readPreparation.mockResolvedValue({results:[{employee_id:'one'}]});
  mocks.readCalculation.mockImplementation(async()=>({results:[{employee_id:'one',is_stale:stale}]}));
  mocks.readStatutory.mockResolvedValue({results:[{employee_id:'one'}]});
  mocks.recalculateEmployee.mockImplementation(async()=>{await work.promise;stale=false;});
  const {result}=renderHook(()=>usePayrollRunRead({id:'run',status:'draft'},null,true,true));
  await waitFor(()=>expect(mocks.recalculateEmployee).toHaveBeenCalledTimes(1));
  let refresh;
  await act(async()=>{refresh=result.current.refresh();});
  await act(async()=>{work.resolve();await refresh;});
  expect(mocks.recalculateEmployee).toHaveBeenCalledTimes(1);
  await act(async()=>{window.dispatchEvent(new Event('focus'));});
  await waitFor(()=>expect(result.current.calculating).toBe(false));
  expect(mocks.recalculateEmployee).toHaveBeenCalledTimes(1);
});

it('coalesces review decisions without reads or calculations until the queue closes', async () => {
 const ready={results:[{employee_id:'employee',status:'ready',is_stale:false}]};
 mocks.readPreparation.mockResolvedValue({results:[{employee_id:'employee'}]});
 mocks.readCalculation.mockResolvedValue(ready); mocks.readStatutory.mockResolvedValue(ready);
 mocks.recalculateEmployee.mockResolvedValue({});
 const {result}=renderHook(()=>usePayrollRunRead({id:'run',status:'draft'},0,true,true));
 await waitFor(()=>expect(result.current.data).toBeTruthy());
 mocks.readPreparation.mockClear(); mocks.readCalculation.mockClear(); mocks.readStatutory.mockClear();
 act(()=>{ result.current.setTimeReviewActive(true); result.current.invalidateEmployee('employee'); result.current.invalidateEmployee('employee'); });
 await act(async()=>{ await result.current.refresh(); window.dispatchEvent(new Event('focus')); });
 expect(mocks.readCalculation).not.toHaveBeenCalled(); expect(mocks.recalculateEmployee).not.toHaveBeenCalled();
 expect(result.current.data.calculation.results[0].is_stale).toBe(true);
 await act(async()=>{ result.current.setTimeReviewActive(false); await result.current.refresh(); });
 expect(mocks.recalculateEmployee).toHaveBeenCalledTimes(1);
 expect(mocks.recalculateEmployee.mock.invocationCallOrder[0]).toBeLessThan(mocks.readCalculation.mock.invocationCallOrder[0]);
});
