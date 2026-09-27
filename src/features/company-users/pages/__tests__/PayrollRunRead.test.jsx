import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { payrollReviewRows, payrollReviewSummary } from "../payrollRunPresentation.js";
const mocks = vi.hoisted(() => ({ readPreparation: vi.fn(), readCalculation: vi.fn(), readStatutory: vi.fn() }));
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
