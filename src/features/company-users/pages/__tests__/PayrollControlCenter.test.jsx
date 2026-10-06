import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  read: vi.fn(), time: vi.fn(), calculation: vi.fn(), statutory: vi.fn(),
  readTime: vi.fn(), readCalculation: vi.fn(), readStatutory: vi.fn(), readPcb: vi.fn(), readRules: vi.fn(), readPreparation: vi.fn(),
  readComponentHistory: vi.fn(), readFinalizedRecord: vi.fn(),
  readHolidayApplicability: vi.fn(),
  readHolidayHistory: vi.fn(), readRunHistory: vi.fn(),
}));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: {
  readRunEvidence: async id => { const [preparation,calculation,statutory,time] = await Promise.all([mocks.readPreparation(id),mocks.readCalculation(id),mocks.readStatutory(id),mocks.readTime()]); return {preparation,calculation,statutory,time,pcb:await mocks.readPcb(id),readiness:{time:await mocks.time(id),calculation:await mocks.calculation(id),statutory:await mocks.statutory(id)}}; },
  read: mocks.read, runTimeReadiness: mocks.time, calculationReadiness: mocks.calculation,
  statutoryReadiness: mocks.statutory, readTime: mocks.readTime,
  readCalculation: mocks.readCalculation, readStatutory: mocks.readStatutory,
  readPcb: mocks.readPcb, readRules: mocks.readRules,
  readPreparation: mocks.readPreparation,
  readPhWork: vi.fn().mockResolvedValue([]),
  readComponentHistory: mocks.readComponentHistory, readFinalizedRecord: mocks.readFinalizedRecord,
  readHolidayApplicability: mocks.readHolidayApplicability,
  readHolidayHistory: mocks.readHolidayHistory, readRunHistory: mocks.readRunHistory,
} }));
vi.mock("../../../../utils/accessControl.js", () => ({ hasPermission: () => true, canEdit: () => true }));

import PayrollPage, { Overview } from "../PayrollPage.jsx";

const fixture = {
  legal_entities: [{ id: "entity-1", name: "QA Employer" }],
  employees: [{ id: "employee-1", name: "QA Employee", employee_code: "QA-001", legal_entity_id: "entity-1" }],
  profiles: [], components: [], holidays: [], periods: [{ id: "period-1", legal_entity_id: "entity-1",
    period_start: "2026-09-01", period_end: "2026-09-30", runs: [{ id: "run-1", status: "review_required", revision: 1 }] }],
};

beforeEach(() => {
  vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
  mocks.read.mockReset().mockResolvedValue(fixture);
  mocks.time.mockReset().mockResolvedValue({ ready: false, unresolved: 1, unreconciled: 0, stale: 0 });
  mocks.calculation.mockReset().mockResolvedValue({ ready: false, review_required: 0, uncalculated: 1, stale: 0 });
  mocks.statutory.mockReset().mockResolvedValue({ ready: false, review_required: 0, uncalculated: 1, stale: 0 });
  mocks.readTime.mockReset().mockResolvedValue([]);
  mocks.readCalculation.mockReset().mockResolvedValue({ results: [], adjustments: [] });
  mocks.readStatutory.mockReset().mockResolvedValue({ results: [] });
  mocks.readPcb.mockReset().mockResolvedValue({ results: [] });
  mocks.readPreparation.mockReset().mockResolvedValue({ results: [] });
  mocks.readRules.mockReset().mockResolvedValue([]);
  mocks.readComponentHistory.mockReset().mockResolvedValue([]);
  mocks.readFinalizedRecord.mockReset().mockResolvedValue({run:{id:"run-final",revision:2,finalized_at:"2026-09-30T12:00:00Z"},period:{period_start:"2026-09-01"},finalized_by_name:"QA Approver",results:[]});
  mocks.readHolidayApplicability.mockReset().mockResolvedValue({ outlets: [], legal_entities: [] });
  mocks.readHolidayHistory.mockReset().mockResolvedValue({ events: [], editable: false });
  mocks.readRunHistory.mockReset().mockResolvedValue([{ run_id: "run-1", period_start: "2026-09-01", revision: 1,
    status: "review_required", employee_count: 1, gross: null, net_pay: null }]);
});
afterEach(()=>{cleanup();vi.useRealTimers();});

describe("Payroll Control Center", () => {
  it("keeps one gated Finalize action in the command header and summarizes its confirmation", async () => {
    mocks.read.mockResolvedValue({...fixture,periods:[{...fixture.periods[0],runs:[{id:"run-1",status:"ready",revision:1}]}]});
    mocks.time.mockResolvedValue({ready:true}); mocks.calculation.mockResolvedValue({ready:true}); mocks.statutory.mockResolvedValue({ready:true});
    mocks.readCalculation.mockResolvedValue({results:[{employee_id:"employee-1",status:"ready",gross_earnings:2000}],adjustments:[]});
    mocks.readStatutory.mockResolvedValue({results:[{employee_id:"employee-1",status:"ready",net_pay:1750,non_statutory_deductions:50,total_employer_cost:2260,lines:[{scheme:"epf",employee_amount:200}]}]});
    mocks.readPcb.mockResolvedValue({results:[{employee_id:"employee-1",applicable:false}]});
    mocks.readPreparation.mockResolvedValue({results:[{employee_id:"employee-1",projection:{status:"ready"},statutory_setup:{complete:true}}]});
    render(<PayrollPage auth={{}} />);
    await screen.findByRole("button",{name:/Continue Payroll/});
    fireEvent.click(screen.getByRole("button",{name:/Continue Payroll/}));
    const finalize=await screen.findByRole("button",{name:"Finalize Payroll",exact:true});
    await waitFor(()=>expect(finalize.disabled).toBe(false));
    expect(screen.getAllByRole("button",{name:"Finalize Payroll",exact:true})).toHaveLength(1);
    fireEvent.click(finalize);
    const confirmation=screen.getByRole("dialog");
    await waitFor(()=>expect(confirmation.textContent.replaceAll("\u00a0"," ")).toContain("RM 1,750.00"));
    expect(confirmation.textContent).toContain("1 employees · 2026-09");
    expect(screen.getByRole("button",{name:"Confirm",exact:true}).disabled).toBe(true);
  });
  it("summarizes canonical readiness and money without raw blocker wording", async () => {
    mocks.readPreparation.mockResolvedValue({results:[
      {employee_id:"a",projection:{status:"ready"},statutory_setup:{complete:true}},
      {employee_id:"b",time_relevant:true,projection:{status:"review_required",issues:["unresolved_time_exception"]},statutory_setup:{complete:false}},
    ]});
    mocks.readCalculation.mockResolvedValue({results:[{employee_id:"a",status:"ready",gross_earnings:2000}]});
    mocks.readStatutory.mockResolvedValue({results:[{employee_id:"a",status:"ready",net_pay:1800,non_statutory_deductions:0,lines:[{employee_amount:200}],total_employer_cost:2250}]});
    const open = vi.fn();
    render(<Overview data={fixture} entityId="entity-1" month="2026-09" run={fixture.periods[0].runs[0]} canManage onOpenRun={open} onOpenEmployees={vi.fn()} />);
    await screen.findByText("1 Ready · 1 Need Attention");
    expect(screen.getByText("1 employee needs time reconciliation")).toBeTruthy();
    expect(screen.getByText("1 employee needs statutory review")).toBeTruthy();
    expect(screen.queryByText(/unresolved_time_exception/)).toBeNull();
    expect(screen.queryByText(/RM\s*0\.00/)).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Review Statutory"}));
    expect(open).toHaveBeenCalledWith(1);
  });
  it("does not present unresolved period membership as zero employees ready", async () => {
    render(<Overview data={fixture} entityId="entity-1" month="2026-09" run={fixture.periods[0].runs[0]}
      readiness={{calculation:{ready:false,employment_issue:"employment_joined_date_missing"}}}
      canManage onOpenRun={vi.fn()} onOpenEmployees={vi.fn()} />);
    await screen.findByText("Employment History Required");
    expect(screen.getAllByText("Joined Date is missing; historical employment for this payroll period cannot be verified.").length).toBeGreaterThan(0);
    expect(screen.queryByText("0 Ready · 0 Need Attention")).toBeNull();
  });
  it("uses canonical financial totals when all employee results are current", async () => {
    mocks.readPreparation.mockResolvedValue({results:[{employee_id:"a",projection:{status:"ready"},statutory_setup:{complete:true}}]});
    mocks.readCalculation.mockResolvedValue({results:[{employee_id:"a",status:"ready",gross_earnings:2000}]});
    mocks.readStatutory.mockResolvedValue({results:[{employee_id:"a",status:"ready",net_pay:1750,non_statutory_deductions:50,lines:[{employee_amount:200}],total_employer_cost:2260}]});
    render(<Overview data={{...fixture,profiles:[{employee_id:"employee-1"}]}} entityId="entity-1" month="2026-09" run={fixture.periods[0].runs[0]} canManage onOpenRun={vi.fn()} />);
    await screen.findByText("1 Ready · 0 Need Attention");
    const statement = screen.getByText("Gross Payroll").closest("dl").textContent.replaceAll("\u00a0"," ");
    expect(statement).toContain("RM 2,000.00"); expect(statement).toContain("RM 250.00"); expect(statement).toContain("RM 1,750.00"); expect(statement).toContain("RM 2,260.00");
  });
  it("gives one current revision per period prominence in recent runs", async () => {
    mocks.readRunHistory.mockResolvedValue([
      {run_id:"old",period_start:"2026-08-01",revision:1,status:"finalized",current:false,net_pay:1000},
      {run_id:"current",period_start:"2026-08-01",revision:2,status:"finalized",current:true,net_pay:1100},
    ]);
    const open=vi.fn();
    render(<Overview data={fixture} entityId="entity-1" month="2026-09" canManage onOpenRun={open} />);
    await screen.findByText("August 2026");
    expect(screen.getAllByRole("button",{name:"View",exact:true})).toHaveLength(1);
    fireEvent.click(screen.getByRole("button",{name:"View",exact:true}));
    expect(open).toHaveBeenCalledWith(2,{legal_entity_id:"entity-1",period_start:"2026-08-01"},"current");
  });
  it("shows scheme-specific component treatment and explicit segmented choices without technical identity", async () => {
    mocks.read.mockResolvedValue({...fixture,settings_authority:{components:true},components:[{id:"component",name:"QA Allowance",component_type:"allowance",is_active:true,epf_treatment:"included",socso_treatment:"excluded",eis_treatment:"undetermined",pcb_treatment:"included"}]});
    render(<PayrollPage auth={{}} />);
    await screen.findByRole("heading", { name: "September 2026 Payroll" });
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "Pay Components" }));
    expect(screen.getByRole("button",{name:"EPF wage base: Included"})).toBeTruthy();
    expect(screen.getByRole("button",{name:"SOCSO wage base: Excluded"})).toBeTruthy();
    expect(screen.getByRole("button",{name:"EIS wage base: Setup required"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:/Add Component/}));
    expect(screen.getAllByRole("tab",{name:"Included"})).toHaveLength(4);
    expect(screen.getAllByRole("tab",{name:"Excluded"})).toHaveLength(4);
    expect(screen.queryByText("Advanced / System Information")).toBeNull();
    expect(screen.queryByText("Undetermined")).toBeNull();
    expect(screen.getByRole("dialog").querySelector("button.btn-primary").disabled).toBe(true);
  });
  it("opens Payroll Runs on history rather than the selected month workflow", async () => {
    render(<PayrollPage auth={{}} />);
    await screen.findByRole("heading", { name: "September 2026 Payroll" });
    fireEvent.click(screen.getByRole("tab", { name: "Payroll Runs" }));
    await screen.findByText("2026-09");
    expect(screen.queryByRole("navigation", { name: "Payroll Run stages" })).toBeNull();
    expect(screen.getByRole("button", { name: "Start Payroll" })).not.toBeNull();
    expect(mocks.readRunHistory).toHaveBeenCalledWith("entity-1");
  });
  it("uses four user-facing destinations and routes a time blocker into the run", async () => {
    render(<PayrollPage auth={{}} />);
    await screen.findByRole("heading", { name: "September 2026 Payroll" });
    expect(screen.getByRole("tablist", { name: "Payroll sections" }).textContent).toBe("OverviewPayroll ProfilesPayroll RunsSettings");
    await screen.findByText("Review time readiness for this period");
    fireEvent.click(screen.getByRole("button", { name: "Review Time & Attendance" }));
    expect(screen.getByRole("navigation", { name: "Payroll Run stages" })).not.toBeNull();
    await screen.findByRole("heading", { name: "Prepare Payroll" });
    expect(mocks.readPreparation).toHaveBeenCalledWith("run-1");
  });

  it("keeps employee setup separate and shows pay rules as managed versions", async () => {
    render(<PayrollPage auth={{}} />);
    await screen.findByRole("heading", { name: "September 2026 Payroll" });
    fireEvent.click(screen.getByRole("tab", { name: "Payroll Profiles" }));
    expect(screen.getAllByText("Set Up Employee").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByText("Manual confirmation")).not.toBeNull();
    await waitFor(() => expect(mocks.readRules).toHaveBeenCalled());
    expect(screen.getByText("Pay Calculation Rules")).not.toBeNull();
  });

  it("replaces the rule detail dialog with the new-version form", async () => {
    mocks.readRules.mockResolvedValueOnce([{ id: "rule-1", rule_code: "monthly_basic", pay_basis: "monthly",
      effective_from: "2000-01-01", multiplier: 1, source_note: "Approved policy" }]);
    render(<PayrollPage auth={{}} />);
    await screen.findByRole("heading", { name: "September 2026 Payroll" });
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    await screen.findByText("Basic Salary");
    fireEvent.click(screen.getAllByRole("button", { name: "View" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Create New Version" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog").textContent).toContain("Effective From");
  });

  it("opens a finalized revision on its immutable summary, not preparation", async () => {
    mocks.read.mockResolvedValueOnce({ ...fixture, periods: [{ ...fixture.periods[0], runs: [{
      id: "run-final", status: "finalized", revision: 2, finalized_at: "2026-09-30T12:00:00Z",
      finalized_by_employee_id: "employee-outside-entity", finalized_by_name: "QA Approver",
    }] }] });
    render(<PayrollPage auth={{}} />);
    await screen.findByRole("heading", { name: "September 2026 Payroll" });
    expect(screen.getByRole("button", { name: /View Finalized Payroll/ })).not.toBeNull();
    expect(screen.getByText("Payroll finalized. The current revision is read-only; any correction creates a new revision.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /View Finalized Payroll/ }));
    await screen.findByText(/Read-only; changes require a Correction Revision/);
    expect(mocks.readFinalizedRecord).toHaveBeenCalledWith("run-final");
    await screen.findByText(/QA Approver/);
    expect(screen.queryByRole("button", { name: "Finalize Payroll" })).toBeNull();
  });

  it("filters employees and opens setup-required employees in read-only detail", async () => {
    mocks.read.mockResolvedValueOnce({ ...fixture, employees: [
      ...fixture.employees, { id: "employee-2", name: "Another Employee", employee_code: "QA-002", legal_entity_id: "entity-1" },
    ] });
    render(<PayrollPage auth={{}} />);
    await screen.findByRole("heading", { name: "September 2026 Payroll" });
    fireEvent.click(screen.getByRole("tab", { name: "Payroll Profiles" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "QA-001" } });
    expect(screen.getByText("QA Employee")).not.toBeNull();
    expect(screen.queryByText("Another Employee")).toBeNull();
    fireEvent.click(screen.getByText("QA Employee"));
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(screen.getByText(/Pay has not been set up/)).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "Reason / provenance" })).toBeNull();
  });
});

 it('keeps one Legal Entity across Profiles, Runs, Settings and Overview',async()=>{
  mocks.read.mockResolvedValue({...fixture,legal_entities:[...fixture.legal_entities,{id:'entity-2',name:'Second Employer'}]});
  render(<PayrollPage auth={{}}/>);
  await screen.findByRole('heading',{name:'September 2026 Payroll'});
  fireEvent.click(screen.getByRole('tab',{name:'Payroll Profiles'}));
  fireEvent.click(screen.getByRole('button',{name:'QA Employer'}));
  fireEvent.click(screen.getByRole('button',{name:'Second Employer',exact:true}));
  for(const tab of ['Payroll Runs','Settings','Overview','Payroll Profiles']){
   fireEvent.click(screen.getByRole('tab',{name:tab,exact:true}));
   await screen.findByRole('button',{name:'Second Employer',exact:true});
  }
  expect(mocks.readRunHistory).toHaveBeenCalledWith('entity-2');
 });
