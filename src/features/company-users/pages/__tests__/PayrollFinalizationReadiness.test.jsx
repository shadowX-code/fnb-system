import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Finalization, { finalizationGates } from "../PayrollFinalizationReadiness.jsx";
afterEach(cleanup);
const readiness = {time:{ready:true},calculation:{ready:true,employees:1,uncalculated:0,review_required:0,stale:0},statutory:{ready:true}};
const read={data:{preparation:{results:[{employee_id:"employee",projection:{status:"ready"},statutory_setup:{complete:true}}]},calculation:{results:[{employee_id:"employee",status:"ready",gross_earnings:2000}]},statutory:{results:[{employee_id:"employee",status:"ready",net_pay:1800,employer_statutory_cost:260,lines:[{employee_amount:200}]}]}}};
it("keeps employee-ready membership-blocked runs disabled and resolves the owning stage",()=>{
 const onResolve=vi.fn(), onFinalize=vi.fn();
 const blocked={...readiness,calculation:{...readiness.calculation,ready:false,employment_issue:"employment_history_unresolved:2026-09-01..2026-09-28"}};
 render(<Finalization run={{}} read={read} readiness={blocked} allReady={false} canFinalize onResolve={onResolve} onFinalize={onFinalize}/>);
 expect(screen.getByText("1 required item remaining")).toBeTruthy();
 expect(screen.getByRole("button",{name:"Finalize Payroll"}).disabled).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:"Resolve Employment / Membership"})); expect(onResolve).toHaveBeenCalledWith(0);
 expect(onFinalize).not.toHaveBeenCalled(); expect(screen.getByText(/Employment assignment history unresolved/)).toBeTruthy();
});
it("bank warnings never grant or remove canonical finalization authority",()=>{
 const {rerender}=render(<Finalization run={{}} read={read} readiness={readiness} allReady canFinalize bankRead={{missingCount:1}}/>);
 expect(screen.getByText(/does not block finalization/)).toBeTruthy();
 expect(screen.getByRole("button",{name:"Finalize Payroll"}).disabled).toBe(false);
 rerender(<Finalization run={{}} read={read} readiness={readiness} allReady={false} canFinalize/>);
 expect(screen.getByRole("button",{name:"Finalize Payroll"}).disabled).toBe(true);
 rerender(<Finalization run={{}} read={read} readiness={readiness} allReady canFinalize={false}/>);
 expect(screen.getByRole("button",{name:"Finalize Payroll"}).disabled).toBe(true);
});
it("statutory resolution goes to Review and changing calculations stay blocked",()=>{
 const onResolve=vi.fn();
 render(<Finalization run={{}} read={{...read,calculating:true}} readiness={{...readiness,statutory:{ready:false}}} allReady={false} canFinalize onResolve={onResolve}/>);
 fireEvent.click(screen.getByRole("button",{name:"Resolve Statutory"}));expect(onResolve).toHaveBeenCalledWith(1);
 expect(screen.getAllByText("Pending").length).toBe(4);
 expect(finalizationGates({...readiness,time:{ready:false,period_in_progress:true}},false).find(g=>g.key==='period').ready).toBe(false);
});
