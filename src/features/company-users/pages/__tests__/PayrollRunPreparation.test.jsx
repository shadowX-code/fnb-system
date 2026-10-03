import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ readPhWork: vi.fn(), readTime: vi.fn(), readCalculation: vi.fn(), readStatutory: vi.fn(), readPcb: vi.fn(), readPreparation: vi.fn(), recalculateEmployee: vi.fn(), saveDraftAdjustment: vi.fn(), decideTime: vi.fn() }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: mocks }));
vi.mock("../../../../services/employeeService.js", () => ({ employeeService: { readBankInfo: async ids => ids.map(id => ({ id, bank_name: "" })) } }));
import PayrollRunEmployeesPanel from "../PayrollRunEmployeesPanel.jsx";
afterEach(cleanup);
beforeEach(() => {
  mocks.readPhWork.mockResolvedValue([]);
  mocks.readTime.mockResolvedValue([]);
  mocks.readCalculation.mockResolvedValue({ results: [], adjustments: [{ id: "line", employee_id: "employee", component_name: "Deduction", component_type: "deduction", amount: 50, reason: "Approved period adjustment" }] });
  mocks.readStatutory.mockResolvedValue({ results: [] });
  mocks.readPcb.mockResolvedValue({ results: [{ employee_id: "employee", applicable: false }] });
  mocks.readPreparation.mockResolvedValue({ results: [{ employee_id: "employee", time_relevant: false, projection: { status: "ready", lines: [] }, statutory_setup: { schemes: { pcb: { applicable: false, state: "not_applicable" } } } }] });
});
const props = { run: { id: "run", status: "draft" }, entityId: "entity", month: "2026-09", canManage: true, data: { employees: [{ id: "employee", name: "QA Employee" }], profiles: [{ employee_id: "employee", compensation: [{ effective_from: "2026-01-01", pay_basis: "monthly", basic_salary: 2000 }], statutory: [{ effective_from: "2026-01-01", pcb_applicable: false }] }] } };
it("keeps monthly time irrelevant and displays persisted deductions before calculation", async () => {
  render(<PayrollRunEmployeesPanel {...props} />);
  expect(screen.queryByRole("button", { name: "All", exact: true })).toBeNull();
  await screen.findByText("QA Employee");
  expect(screen.getByText("Not required")).toBeTruthy();
  expect(screen.getByText(/1 adjustment/)).toBeTruthy();
  expect(screen.queryByText("Confirm amount")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review", exact: true }));
  expect(screen.getByText("Deduction")).toBeTruthy();
  expect(screen.getByText("Saved adjustment · Approved period adjustment")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Time & Attendance" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Review Hours" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Confirm PCB" })).toBeNull();
});
it("resolves period-effective categories and PCB N/A beside current amounts", async () => {
  mocks.readCalculation.mockResolvedValue({ results: [{ employee_id: "employee", status: "ready", gross_earnings: 2000, lines: [{kind:"earning",label:"Basic Salary",amount:2000}] }], adjustments: [] });
  mocks.readStatutory.mockResolvedValue({ results: [{ employee_id:"employee",status:"ready", net_pay:1766.35, non_statutory_deductions:0, lines:[
    {scheme:"epf",applicable:true,employee_amount:220,employer_amount:260},
    {scheme:"socso",applicable:true,employee_amount:9.75,employer_amount:34.15},
    {scheme:"lindung",applicable:false,employee_amount:0,employer_amount:0},
    {scheme:"eis",applicable:true,employee_amount:3.9,employer_amount:3.9},
    {scheme:"pcb",applicable:false,employee_amount:0,employer_amount:0},
  ] }] });
  mocks.readPreparation.mockResolvedValue({results:[{employee_id:"employee",statutory_setup:{complete:true,schemes:{
    epf:{state:"confirmed",applicable:true,category:"malaysian_under_60"},
    socso:{state:"confirmed",applicable:true,category:"first_category_base"},
    lindung:{state:"not_applicable",applicable:false,status:"valid_opt_out"},
    eis:{state:"confirmed",applicable:true,category:"standard"},
    pcb:{state:"not_applicable",applicable:false},
  }},projection:{status:"ready",inputs:{compensation_start:{id:"pay",pay_basis:"monthly",basic_salary:2000,effective_from:"2026-01-01"}}}}]});
  render(<PayrollRunEmployeesPanel {...props} />);
  await screen.findByText("Ready · EPF / SOCSO / EIS");
  fireEvent.click(screen.getByRole("button",{name:"Review",exact:true}));
  expect(screen.getByText("Malaysian · under 60")).toBeTruthy();
  expect(screen.getByText("Act 4 · First Category")).toBeTruthy();
  expect(screen.queryByText("Setup Required")).toBeNull();
  expect(screen.getAllByText(/1,766.35/).length).toBe(2);
  expect(screen.queryByRole("heading",{name:"Time & Attendance"})).toBeNull();
});
it("removes a Draft adjustment without required remark and refreshes only that employee", async () => {
  mocks.saveDraftAdjustment.mockResolvedValue({});
  mocks.recalculateEmployee.mockResolvedValue({});
  render(<PayrollRunEmployeesPanel {...props} />);
  await screen.findByText("QA Employee");
  fireEvent.click(screen.getByRole("button",{name:"Review",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"Remove",exact:true}));
  expect(screen.queryByRole("textbox",{name:/Reason/})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Remove Adjustment"}));
  await waitFor(()=>expect(mocks.recalculateEmployee).toHaveBeenCalledWith("run","employee"));
  expect(mocks.saveDraftAdjustment).toHaveBeenCalledWith(expect.objectContaining({action:"remove",adjustmentId:"line",reason:""}));
  expect(mocks.saveDraftAdjustment.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.recalculateEmployee.mock.invocationCallOrder.at(-1));
});
it("still exposes time-dependent employee evidence", async () => {
  mocks.readPreparation.mockResolvedValue({ results: [{ employee_id: "employee", time_relevant: true, projection: { status: "review_required", issues: ["unreconciled_time:2026-09-01"], lines: [] } }] });
  render(<PayrollRunEmployeesPanel {...props} />);
  await screen.findByText("QA Employee");
  expect(screen.getByText("Time evidence required")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review", exact: true }));
  expect(screen.getByRole("heading", { name: "Time & Attendance" })).toBeTruthy();
});
it("edits an existing Draft input and recalculates after the atomic save", async () => {
  mocks.readCalculation.mockResolvedValue({results:[],adjustments:[{id:"line",employee_id:"employee",component_id:"component",component_name:"QA allowance",component_type:"allowance",amount:50,reason:"Previous evidence"}]});
  mocks.saveDraftAdjustment.mockResolvedValue("replacement");
  mocks.recalculateEmployee.mockResolvedValue({});
  render(<PayrollRunEmployeesPanel {...props} data={{...props.data,components:[{id:"component",name:"QA allowance",component_type:"allowance",is_active:true,epf_treatment:"excluded",socso_treatment:"excluded",eis_treatment:"excluded",pcb_treatment:"excluded"}]}} />);
  await screen.findByText("QA Employee");
  fireEvent.click(screen.getByRole("button",{name:"Review",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"Edit",exact:true}));
  const input=screen.getByRole("spinbutton",{name:/Amount/});
  expect(input.value).toBe("50");
  fireEvent.change(input,{target:{value:"54"}});
  fireEvent.click(screen.getByRole("button",{name:"Edit Adjustment",exact:true}));
  await waitFor(()=>expect(mocks.saveDraftAdjustment).toHaveBeenCalledWith(expect.objectContaining({action:"edit",adjustmentId:"line",componentId:"component",amount:"54",reason:""})));
  await waitFor(()=>expect(mocks.recalculateEmployee).toHaveBeenLastCalledWith("run","employee"));
});
it("shows calculated adjustment provenance once and derives the chosen component type", async () => {
  mocks.readCalculation.mockResolvedValue({ results: [{ employee_id: "employee", status: "ready", gross_earnings: 2050, lines: [
    {kind:"earning",label:"Basic Salary",amount:2000},
    {kind:"earning",label:"QA Allowance",amount:50,source:{run_adjustment_id:"adjustment"}},
    {kind:"deduction",label:"QA Deduction",amount:20},
    {kind:"reimbursement",label:"QA Reimbursement",amount:10},
  ],reimbursements:10 }], adjustments: [{id:"adjustment",employee_id:"employee",component_name:"QA Allowance",component_type:"allowance",amount:50,reason:"Approved QA expense"}] });
  mocks.readStatutory.mockResolvedValue({results:[{employee_id:"employee",status:"ready",non_statutory_deductions:20,net_pay:2040,employer_statutory_cost:0,total_employer_cost:2060,lines:[]}]});
  render(<PayrollRunEmployeesPanel {...props} data={{...props.data,components:[{id:"ded",name:"QA Deduction",component_type:"deduction",is_active:true,epf_treatment:"excluded",socso_treatment:"excluded",eis_treatment:"excluded",pcb_treatment:"excluded"},{id:"unresolved",name:"Unresolved component",component_type:"allowance",is_active:true}]}} />);
  await screen.findByText("QA Employee");
  fireEvent.click(screen.getByRole("button",{name:"Review",exact:true}));
  expect(screen.getAllByText("QA Allowance")).toHaveLength(1);
  expect(screen.getByText("This period adjustment · Approved QA expense")).toBeTruthy();
  expect(screen.getAllByText("QA Deduction")).toHaveLength(1);
  expect(screen.getByText("Business Reimbursements")).toBeTruthy();
  expect(screen.queryByText("This Period Adjustments")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Add Adjustment",exact:true}));
  expect(screen.queryByRole("button",{name:"Earning"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Select"}));
  expect(screen.getByRole("button",{name:"Unresolved component · Allowance · Setup required"}).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"QA Deduction · Deduction"}));
  expect(screen.getByText("Deduction")).toBeTruthy();
});
it("records a time decision before employee-only recalculation and projection refresh", async () => {
  mocks.readPreparation.mockResolvedValue({results:[{employee_id:'employee',time_relevant:true,projection:{status:'review_required',lines:[],inputs:{compensation_start:{pay_basis:'hourly',hourly_rate:15.5}}}}]});
  mocks.readTime.mockResolvedValue([{id:'time',employee_id:'employee',employee_name:'QA Employee',work_date:'2026-09-25',status:'review_required',classification:'regular',issue_codes:['missing_punch'],proposed_minutes:null,evidence:{}}]);
  mocks.decideTime.mockResolvedValue({});
  mocks.recalculateEmployee.mockResolvedValue({});
  render(<PayrollRunEmployeesPanel {...props} />);
  await screen.findByText('QA Employee');
  fireEvent.click(screen.getByRole('button',{name:'Review',exact:true}));
  fireEvent.click(screen.getByRole('button',{name:'Review Hours'}));
  fireEvent.click(screen.getByRole('button',{name:'Review exception'}));
  fireEvent.change(screen.getByRole('spinbutton',{name:/Approved payable minutes/}),{target:{value:'120'}});
  fireEvent.change(screen.getByRole('textbox',{name:/Decision reason/}),{target:{value:'Verified QA evidence'}});
  fireEvent.click(screen.getByRole('button',{name:'Save & Finish'}));
  await waitFor(()=>expect(mocks.decideTime).toHaveBeenCalled());
  await waitFor(()=>expect(mocks.recalculateEmployee).toHaveBeenLastCalledWith('run','employee'));
  expect(mocks.decideTime.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.recalculateEmployee.mock.invocationCallOrder.at(-1));
  await waitFor(()=>expect(mocks.readPreparation.mock.invocationCallOrder.at(-1)).toBeGreaterThan(mocks.recalculateEmployee.mock.invocationCallOrder.at(-1)));
});

it("uses a compact processing table and keeps bank absence informational", async () => {
  mocks.readCalculation.mockResolvedValue({results:[{employee_id:"employee",status:"ready",gross_earnings:2000,lines:[]}],adjustments:[]});
  mocks.readStatutory.mockResolvedValue({results:[{employee_id:"employee",status:"ready",non_statutory_deductions:0,net_pay:1900,total_employer_cost:2200,lines:[{scheme:"socso",employee_amount:100,employer_amount:200}]}]});
  mocks.readPreparation.mockResolvedValue({results:[{employee_id:"employee",time_relevant:false,statutory_setup:{complete:true,schemes:{socso:{state:"confirmed",applicable:true},epf:{state:"not_applicable",applicable:false},eis:{state:"not_applicable",applicable:false},pcb:{state:"not_applicable",applicable:false}}},projection:{status:"ready",inputs:{compensation_start:{id:"pay",pay_basis:"monthly",basic_salary:2000,effective_from:"2026-01-01"}}}}]});
  const snapshot=vi.fn();
  render(<PayrollRunEmployeesPanel {...props} stage="review" onSnapshot={snapshot} />);
  await screen.findByText("Complete");
  expect(screen.getAllByRole("columnheader").map(item=>item.textContent)).toEqual(["Employee","Pay Basis","Basic / Hours","Gross","Deductions","Statutory","Net Pay","Bank Info","Status","Actions"]);
  await screen.findByText("Missing");
  expect(screen.getByRole("region",{name:"Payroll review filters"})).toBeTruthy();
  expect(screen.getByText("Ready")).toBeTruthy();
  expect(screen.getByText(/1,900.00/)).toBeTruthy();
  expect(snapshot).toHaveBeenLastCalledWith(expect.objectContaining({runId:"run",rows:[expect.objectContaining({needsReview:false})]}));
  fireEvent.click(screen.getByRole("button",{name:"Review pay basis"}));
  fireEvent.click(screen.getByRole("button",{name:"Hourly",exact:true}));
  expect(screen.getByText("No employees match these review filters.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Review pay basis"}));
  fireEvent.click(screen.getByRole("button",{name:"All",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"Review status"}));
  fireEvent.click(screen.getByRole("button",{name:"Need Attention",exact:true}));
  expect(screen.getByText("No employees match these review filters.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Review status"}));
  fireEvent.click(screen.getByRole("button",{name:"All",exact:true}));
  fireEvent.change(screen.getByRole("searchbox",{name:"Search Employee"}),{target:{value:"unknown"}});
  expect(screen.getByText("No employees match these review filters.")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox",{name:"Search Employee"}),{target:{value:"QA"}});
  fireEvent.click(screen.getByRole("button",{name:"View",exact:true}));
  expect(screen.getByRole("heading",{name:"Compensation"})).toBeTruthy();
  expect(screen.getByRole("heading",{name:"Bank Information"})).toBeTruthy();
  expect(screen.queryByRole("heading",{name:"Time & Attendance"})).toBeNull();
});

it("puts human-readable blockers first and hides unresolved Net Pay", async () => {
  mocks.readPreparation.mockResolvedValue({results:[{employee_id:"employee",projection:{status:"review_required",issues:["pay_history_missing:2026-09-01..2026-09-25"],inputs:{compensation_end:{pay_basis:"monthly",basic_salary:1700}}}}]});
  render(<PayrollRunEmployeesPanel {...props} stage="review" />);
  await screen.findByRole("button",{name:"View",exact:true});
  const net=screen.getByRole("columnheader",{name:"Net Pay"});
  expect(net).toBeTruthy();
  expect(screen.getAllByRole("cell").some(cell=>cell.textContent==="—")).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"View",exact:true}));
  const blockers=screen.getByRole("region",{name:"Review blockers"});
  expect(blockers.textContent).toContain("Pay history missing · 2026-09-01 – 2026-09-25");
  expect(blockers.compareDocumentPosition(screen.getByRole("heading",{name:"Earnings"})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it.each([false, true])("uses only frozen LINDUNG evidence in finalized Review (present=%s)", async present => {
  mocks.readCalculation.mockResolvedValue({results:[{employee_id:"employee",status:"ready",gross_earnings:2000,lines:[]}],adjustments:[]});
  mocks.readStatutory.mockResolvedValue({results:[{employee_id:"employee",status:"ready",net_pay:1900,lines: present ? [{scheme:"lindung",applicable:true,participation_status:"participating",employee_amount:14.65,employer_amount:0}] : []}]});
  render(<PayrollRunEmployeesPanel {...props} run={{...props.run,status:"finalized"}} stage="review" />);
  await screen.findByText("QA Employee");
  fireEvent.click(screen.getByRole("button",{name:"View",exact:true}));
  if(present) {
    expect(screen.getByText("LINDUNG 24 Jam")).toBeTruthy();
    expect(screen.getByText("Participating")).toBeTruthy();
    expect(screen.getAllByText(/14.65/).length).toBeGreaterThan(0);
  } else expect(screen.queryByText("LINDUNG 24 Jam")).toBeNull();
});

it('preserves employee and active exception when the shared run projection refreshes',async()=>{
  const time=[{id:'t1',employee_id:'employee',employee_name:'QA Employee',work_date:'2026-09-25',status:'review_required',classification:'regular',proposed_minutes:120,evidence:{}}, {id:'t2',employee_id:'employee',employee_name:'QA Employee',work_date:'2026-09-26',status:'review_required',classification:'regular',proposed_minutes:180,evidence:{}}];
  mocks.readTime.mockResolvedValue(time);
  const snapshot={preparation:{results:[{employee_id:'employee',time_relevant:true,projection:{status:'review_required',lines:[],inputs:{compensation_start:{pay_basis:'hourly',hourly_rate:15}}}}]},calculation:{results:[],adjustments:[]},statutory:{results:[]}};
  const view=render(<PayrollRunEmployeesPanel {...props} runRead={{data:snapshot,refresh:vi.fn()}} />);
  await screen.findByText('QA Employee');
  fireEvent.click(screen.getByRole('button',{name:'Review',exact:true}));
  fireEvent.click(screen.getByRole('button',{name:'Review Hours'}));
  fireEvent.click(screen.getByRole('button',{name:'Continue Review'}));
  fireEvent.change(screen.getByRole('textbox',{name:/Decision reason/}),{target:{value:'Keep this unsaved draft'}});
  view.rerender(<PayrollRunEmployeesPanel {...props} runRead={{data:{...snapshot},refresh:vi.fn()}} />);
  await waitFor(()=>expect(screen.getByRole('textbox',{name:/Decision reason/}).value).toBe('Keep this unsaved draft'));
  expect(screen.getByText('1 of 2 exceptions')).toBeTruthy();
});
