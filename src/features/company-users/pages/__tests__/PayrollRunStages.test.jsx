import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks=vi.hoisted(()=>({bank:vi.fn(),history:vi.fn(),readRunEvidence:vi.fn(),recalculateEmployee:vi.fn()}));
vi.mock("../../../../services/employeeService.js",()=>({employeeService:{readBankInfo:mocks.bank}}));
vi.mock("../../../../services/payrollService.js",()=>({payrollService:{readRunHistory:mocks.history,readRunEvidence:mocks.readRunEvidence,recalculateEmployee:mocks.recalculateEmployee}}));
import { RunsTab } from "../PayrollPage.jsx";
afterEach(()=>{cleanup();vi.resetAllMocks();});
it("reuses run evidence and bank batch through Prepare, Review, Finalize and Resolve",async()=>{
 mocks.bank.mockResolvedValue([{id:'employee',bank_name:''}]);mocks.history.mockResolvedValue([]);
 const evidence={time:[],pcb:{results:[]},preparation:{results:[{employee_id:'employee',projection:{status:'ready'},statutory_setup:{complete:true}}]},
 calculation:{results:[{employee_id:'employee',status:'ready',gross_earnings:2000}],adjustments:[]},statutory:{results:[{employee_id:'employee',status:'ready',net_pay:1800,total_employer_cost:2260,employer_statutory_cost:260,lines:[{employee_amount:200}]}]}};
 const props={data:{legal_entities:[{id:'entity',name:'QA'}],employees:[{id:'employee',name:'QA Employee'}],periods:[{legal_entity_id:'entity',period_start:'2026-09-01',runs:[{id:'run',status:'draft'}]}]},
 entityId:'entity',month:'2026-09',openRunId:'run',canManage:true,canFinalize:true,canEditEmployee:true,setStep:vi.fn(),runRead:{data:evidence,setTimeReviewActive:vi.fn()},readiness:{runId:'run',time:{ready:true},calculation:{ready:false,employees:1,employment_issue:'employment_history_unresolved',uncalculated:0,review_required:0,stale:0},statutory:{ready:true}}};
 const {rerender}=render(<RunsTab {...props} step={0}/>);
 await screen.findByRole('button',{name:'View Time for QA Employee'}); await waitFor(()=>expect(mocks.bank).toHaveBeenCalledTimes(1));
 expect(screen.getByText('1 / 1 employees ready')).toBeTruthy();expect(screen.getByText('Run readiness: 1 blocker remaining')).toBeTruthy();
 rerender(<RunsTab {...props} step={1}/>);
 expect(screen.getByRole('button',{name:'View Payroll for QA Employee'})).toBeTruthy();
 expect(screen.queryByText('Loading monthly employee evidence…')).toBeNull();
 expect(screen.getAllByRole('columnheader').map(el=>el.textContent).slice(-3)).toEqual(['Bank','Status','Actions']);
 expect(screen.getByRole('button',{name:'Draft Payslip'}).querySelector('svg')).toBeNull();
 rerender(<RunsTab {...props} step={2}/>);
 expect(screen.getByRole('heading',{name:'Finalization Readiness'})).toBeTruthy();expect(screen.getByRole('button',{name:'Finalize Payroll'}).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Resolve Employment / Membership'}));expect(props.setStep).toHaveBeenCalledWith(0);
 rerender(<RunsTab {...props} step={0}/>);
 await screen.findByRole('button',{name:'View Time for QA Employee'});
 expect(mocks.bank).toHaveBeenCalledTimes(1);expect(mocks.history).not.toHaveBeenCalled();
 expect(mocks.readRunEvidence).not.toHaveBeenCalled();expect(mocks.recalculateEmployee).not.toHaveBeenCalled();
});
