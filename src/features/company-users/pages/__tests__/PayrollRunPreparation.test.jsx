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
  expect(screen.getByText("Ready")).toBeTruthy();
  expect(screen.getByText(/1 adjustment/)).toBeTruthy();
  expect(screen.queryByText("Confirm amount")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review", exact: true }));
  expect(screen.getByText("Deduction")).toBeTruthy();
  expect(screen.getByText("Saved adjustment · Approved period adjustment")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Time & Attendance" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Review Time" })).toBeNull();
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
  mocks.readPreparation.mockResolvedValue({ results: [{ employee_id: "employee", time_relevant: true, time_exception_count: 1, projection: { status: "review_required", issues: ["unreconciled_time:2026-09-01"], lines: [] } }] });
  render(<PayrollRunEmployeesPanel {...props} />);
  await screen.findByText("QA Employee");
  expect(screen.getByText("1 exception")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review", exact: true }));
  expect(screen.getByRole("heading", { name: "Time & Attendance — Review Required" })).toBeTruthy();
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
  fireEvent.click((screen.queryByRole("button",{name:/Pay Component/}) || screen.getByRole("button",{name:"Select"})));
  expect((screen.queryByRole("option",{name:"Unresolved component · Allowance · Setup required"}) || screen.getByRole("button",{name:"Unresolved component · Allowance · Setup required"})).disabled).toBe(true);
  fireEvent.click((screen.queryByRole("option",{name:"QA Deduction · Deduction"}) || screen.getByRole("button",{name:"QA Deduction · Deduction"})));
  expect(screen.getByText("Deduction")).toBeTruthy();
});
it("advances from committed day read-back without waiting for month projections", async () => {
  mocks.recalculateEmployee.mockClear();
  mocks.readPreparation.mockResolvedValue({results:[{employee_id:'employee',time_relevant:true,projection:{status:'review_required',lines:[],inputs:{compensation_start:{pay_basis:'hourly',hourly_rate:15.5}}}}]});
  mocks.readTime.mockResolvedValue([{id:'time',employee_id:'employee',employee_name:'QA Employee',work_date:'2026-09-25',status:'review_required',classification:'regular',issue_codes:['missing_punch'],proposed_minutes:null,evidence:{}}]);
  const committed={id:'saved-time',employee_id:'employee',work_date:'2026-09-25',status:'approved_manual',approved_minutes:120,classification:'regular',evidence:{}};
  mocks.decideTime.mockResolvedValue({row:committed,calculation_stale:true});
  mocks.recalculateEmployee.mockResolvedValue({});
  render(<PayrollRunEmployeesPanel {...props} />);
  await screen.findByText('QA Employee');
  fireEvent.click(screen.getByRole('button',{name:'Review',exact:true}));
  fireEvent.click(screen.getByRole('button',{name:'Review Time'}));
  fireEvent.click(screen.getByRole('button',{name:'Review exception'}));
  fireEvent.change(screen.getByRole('spinbutton',{name:/Approved payable minutes/}),{target:{value:'120'}});
  fireEvent.change(screen.getByRole('textbox',{name:/Decision reason/}),{target:{value:'Verified QA evidence'}});
  fireEvent.click(screen.getByRole('button',{name:'Save & Finish'}));
  await waitFor(()=>expect(mocks.decideTime).toHaveBeenCalled());
  expect(mocks.decideTime).toHaveBeenCalledWith(expect.objectContaining({runId:'run',requestId:expect.any(String),correction:false}));
  await waitFor(()=>expect(mocks.readPreparation.mock.invocationCallOrder.at(-1)).toBeGreaterThan(mocks.decideTime.mock.invocationCallOrder.at(-1))); // finish automatically refreshes outside the save
});

it("uses a compact processing table and keeps bank absence informational", async () => {
  mocks.readCalculation.mockResolvedValue({results:[{employee_id:"employee",status:"ready",gross_earnings:2000,lines:[]}],adjustments:[]});
  mocks.readStatutory.mockResolvedValue({results:[{employee_id:"employee",status:"ready",non_statutory_deductions:0,net_pay:1900,total_employer_cost:2200,lines:[{scheme:"socso",employee_amount:100,employer_amount:200}]}]});
  mocks.readPreparation.mockResolvedValue({results:[{employee_id:"employee",time_relevant:false,statutory_setup:{complete:true,schemes:{socso:{state:"confirmed",applicable:true},epf:{state:"not_applicable",applicable:false},eis:{state:"not_applicable",applicable:false},pcb:{state:"not_applicable",applicable:false}}},projection:{status:"ready",inputs:{compensation_start:{id:"pay",pay_basis:"monthly",basic_salary:2000,effective_from:"2026-01-01"}}}}]});
  const snapshot=vi.fn();
  render(<PayrollRunEmployeesPanel {...props} stage="review" onSnapshot={snapshot} />);
  await screen.findByText("QA Employee");
  expect(screen.getAllByRole("columnheader").map(item=>item.textContent)).toEqual(["Employee","Pay Basis","Basic / Hours","Gross","EPF","SOCSO","EIS","PCB","Deductions","Net Pay","Employer Cost","Bank","Status","Actions"]);
  expect(screen.queryByText("Missing")).toBeNull();
  expect(screen.getByText(/EE RM\s*100.00/)).toBeTruthy();
  expect(screen.getByText(/ER RM\s*200.00/)).toBeTruthy();
  expect(screen.getByRole("region",{name:"Payroll review filters"})).toBeTruthy();
  expect(screen.getByText("Ready")).toBeTruthy();
  expect(screen.getByText(/1,900.00/)).toBeTruthy();
  await waitFor(()=>expect(snapshot).toHaveBeenLastCalledWith(expect.objectContaining({runId:"run",rows:[expect.objectContaining({needsReview:false})]})));
  fireEvent.click(screen.getByRole("button",{name:"Review pay basis"}));
  fireEvent.click((screen.queryByRole("option",{name:"Hourly",exact:true}) || screen.getByRole("button",{name:"Hourly",exact:true})));
  expect(screen.getByText("No employees match these review filters.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Review pay basis"}));
  fireEvent.click((screen.queryByRole("option",{name:"All",exact:true}) || screen.getByRole("button",{name:"All",exact:true})));
  fireEvent.click(screen.getByRole("button",{name:"Review status"}));
  fireEvent.click((screen.queryByRole("option",{name:"Need Attention",exact:true}) || screen.getByRole("button",{name:"Need Attention",exact:true})));
  expect(screen.getByText("No employees match these review filters.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Review status"}));
  fireEvent.click((screen.queryByRole("option",{name:"All",exact:true}) || screen.getByRole("button",{name:"All",exact:true})));
  fireEvent.change(screen.getByRole("searchbox",{name:"Search Employee"}),{target:{value:"unknown"}});
  expect(screen.getByText("No employees match these review filters.")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox",{name:"Search Employee"}),{target:{value:"QA"}});
  fireEvent.click(screen.getByRole("button",{name:"View Payroll for QA Employee",exact:true}));
  expect(screen.getByRole("heading",{name:"Compensation"})).toBeTruthy();
  expect(screen.getByRole("heading",{name:"Bank Information"})).toBeTruthy();
  expect(screen.queryByRole("heading",{name:"Time & Attendance"})).toBeNull();
});

it("puts human-readable blockers first and hides unresolved Net Pay", async () => {
  mocks.readPreparation.mockResolvedValue({results:[{employee_id:"employee",projection:{status:"review_required",issues:["pay_history_missing:2026-09-01..2026-09-25"],inputs:{compensation_end:{pay_basis:"monthly",basic_salary:1700}}}}]});
  render(<PayrollRunEmployeesPanel {...props} stage="review" />);
  await screen.findByRole("button",{name:"View Payroll for QA Employee",exact:true});
  const net=screen.getByRole("columnheader",{name:"Net Pay"});
  expect(net).toBeTruthy();
  expect(screen.getAllByRole("cell").some(cell=>cell.textContent==="—")).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"View Payroll for QA Employee",exact:true}));
  const blockers=screen.getByRole("region",{name:"Review blockers"});
  expect(blockers.textContent).toContain("Pay history missing · 2026-09-01 – 2026-09-25");
  expect(blockers.compareDocumentPosition(screen.getByRole("heading",{name:"Earnings"})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it.each([false, true])("uses only frozen LINDUNG evidence in finalized Review (present=%s)", async present => {
  mocks.readCalculation.mockResolvedValue({results:[{employee_id:"employee",status:"ready",gross_earnings:2000,lines:[]}],adjustments:[]});
  mocks.readStatutory.mockResolvedValue({results:[{employee_id:"employee",status:"ready",net_pay:1900,lines: present ? [{scheme:"lindung",applicable:true,participation_status:"participating",employee_amount:14.65,employer_amount:0}] : []}]});
  render(<PayrollRunEmployeesPanel {...props} run={{...props.run,status:"finalized"}} stage="review" />);
  await screen.findByText("QA Employee");
  fireEvent.click(screen.getByRole("button",{name:"View Payroll for QA Employee",exact:true}));
  if(present) {
    expect(screen.getByText("LINDUNG 24 Jam")).toBeTruthy();
    expect(screen.getByText("Participating")).toBeTruthy();
    expect(screen.getAllByText(/14.65/).length).toBeGreaterThan(0);
  } else expect(screen.queryByText("LINDUNG 24 Jam")).toBeNull();
});

it('preserves employee and active exception when the shared run projection refreshes',async()=>{
  const time=[{id:'t1',employee_id:'employee',employee_name:'QA Employee',work_date:'2026-09-25',status:'review_required',classification:'regular',proposed_minutes:120,evidence:{}}, {id:'t2',employee_id:'employee',employee_name:'QA Employee',work_date:'2026-09-26',status:'review_required',classification:'regular',proposed_minutes:180,evidence:{}}];
  mocks.readTime.mockResolvedValue(time);
  const snapshot={time,pcb:{results:[]},preparation:{results:[{employee_id:'employee',time_relevant:true,projection:{status:'review_required',lines:[],inputs:{compensation_start:{pay_basis:'hourly',hourly_rate:15}}}}]},calculation:{results:[],adjustments:[]},statutory:{results:[]}};
  const view=render(<PayrollRunEmployeesPanel {...props} runRead={{data:snapshot,refresh:vi.fn(),calculating:true}} />);
  await screen.findByText('QA Employee');
  fireEvent.click(screen.getByRole('button',{name:'Review',exact:true}));
  fireEvent.click(screen.getByRole('button',{name:'Review Time'}));
  fireEvent.click(screen.getByRole('button',{name:'Continue Review'}));
  fireEvent.change(screen.getByRole('textbox',{name:/Decision reason/}),{target:{value:'Keep this unsaved draft'}});
  view.rerender(<PayrollRunEmployeesPanel {...props} runRead={{data:{...snapshot},refresh:vi.fn()}} />);
  await waitFor(()=>expect(screen.getByRole('textbox',{name:/Decision reason/}).value).toBe('Keep this unsaved draft'));
  expect(screen.getByText('1 of 2 exceptions')).toBeTruthy();
});

it('shows resolved Regular aggregate while an independent PH blocker keeps overall readiness pending',async()=>{
 const daily={kind:'earning',code:'regular',label:'Regular',amount:40,minutes:300,multiplier:1,source:{work_date:'2026-09-22'}};
 mocks.readCalculation.mockResolvedValue({results:[{employee_id:'employee',pay_basis:'hourly',status:'review_required',is_stale:false,issues:['ph_statutory_rule_unverified:hourly:2026-09-16'],gross_earnings:80,lines:[daily,{...daily,source:{work_date:'2026-09-23'}}],earning_groups:[{...daily,label:'Regular Pay',amount:80,minutes:600,rate:8,day_count:2}]}],adjustments:[]});
 render(<PayrollRunEmployeesPanel {...props}/>); await screen.findByText('QA Employee');
 fireEvent.click(screen.getByRole('button',{name:'Review',exact:true}));
 expect(screen.getByText('Regular Pay')).toBeTruthy(); expect(screen.getAllByText(/RM\s*80\.00/).length).toBeGreaterThan(0);
 expect(screen.getByText('Calculation details')).toBeTruthy();
 expect(screen.getByText(/requires a verified Malaysia hourly PH/)).toBeTruthy();
});

it('shows clean Monthly time Ready from canonical evidence without daily approval, with View Time access', async () => {
  mocks.readTime.mockResolvedValue([{employee_id:'employee',status:'review_required',work_date:'2026-09-01',review_state:{required:false,automatic:true,state:'ready'}}]);
  mocks.readPreparation.mockResolvedValue({results:[{employee_id:'employee',time_exception_count:0,time_relevant:false,projection:{status:'ready',issues:[],inputs:{compensation_start:{id:'pay',pay_basis:'monthly',basic_salary:3000}}}}]});
  render(<PayrollRunEmployeesPanel {...props} />);
  await screen.findByText('QA Employee');
  expect(screen.getByText('Ready')).toBeTruthy();
  expect(screen.queryByRole('button',{name:/Review Time/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Review',exact:true}));
  expect(screen.getByRole('heading',{name:'Time & Attendance — Ready'})).toBeTruthy();
  expect(screen.getByText(/Normal attendance does not require daily hours approval/)).toBeTruthy();
});

it('counts only canonical unresolved time exceptions when PH and normal rows coexist', async () => {
  mocks.readTime.mockResolvedValue([{employee_id:'employee',status:'review_required',work_date:'2026-09-16',review_state:{required:false,state:'ph_review'}},{employee_id:'employee',status:'review_required',work_date:'2026-09-17',review_state:{required:true,state:'review_required'}}]);
  mocks.readPreparation.mockResolvedValue({results:[{employee_id:'employee',time_exception_count:1,time_relevant:true,projection:{status:'review_required',issues:['unresolved_time_exception:2026-09-17','ph_occurrence_review_required:2026-09-16'],inputs:{compensation_start:{id:'pay',pay_basis:'monthly',basic_salary:3000}}}}]});
  render(<PayrollRunEmployeesPanel {...props} />);
  await screen.findByText('1 exception');
  fireEvent.click(screen.getByRole('button',{name:'Review Time for QA Employee'}));
  expect(screen.getByRole('dialog',{name:'Time & Attendance · QA Employee'})).toBeTruthy();
  expect(screen.getByText('2026-09-16')).toBeTruthy();
  expect(screen.getByText('PH treatment is separate in Employee Review.')).toBeTruthy();
});

it('Ready → View Time → Draft correction invalidates the employee and resumes automatic calculation', async () => {
 const ready={id:'ready-time',employee_id:'employee',employee_name:'QA Employee',work_date:'2026-09-25',status:'approved_auto',classification:'regular',approved_minutes:480,proposed_minutes:480,evidence:{},review_state:{required:true,state:'ready'}};
 const corrected={...ready,id:'corrected-time',status:'approved_manual',approved_minutes:420};
 mocks.decideTime.mockClear().mockResolvedValue({row:corrected});
 const invalidate=vi.fn(),suspend=vi.fn(),refresh=vi.fn().mockResolvedValue(true);
 const data={time:[ready],preparation:{results:[{employee_id:'employee',time_exception_count:0,projection:{status:'ready',inputs:{compensation_start:{id:'pay',pay_basis:'hourly',hourly_rate:8}}}}]},calculation:{results:[],adjustments:[]},statutory:{results:[]},pcb:{results:[]}};
 render(<PayrollRunEmployeesPanel {...props} runRead={{data,invalidateEmployee:invalidate,setTimeReviewActive:suspend,refresh}} />);
 await screen.findByRole('button',{name:'View Time for QA Employee'});
 fireEvent.click(screen.getByRole('button',{name:'View Time for QA Employee'}));
 fireEvent.click(screen.getByRole('button',{name:'Correct Decision'}));
 fireEvent.change(screen.getByRole('spinbutton',{name:/Approved payable minutes/}),{target:{value:'420'}});
 fireEvent.change(screen.getByRole('textbox',{name:/Correction reason/}),{target:{value:'Verified genuine hours correction'}});
 fireEvent.click(screen.getByRole('button',{name:'Save Correction'}));
 await waitFor(()=>expect(invalidate).toHaveBeenCalledWith('employee'));
 expect(suspend).toHaveBeenCalledWith(true);
 fireEvent.click(await screen.findByRole('button',{name:'Back to Employee Review'}));
 expect(suspend).toHaveBeenLastCalledWith(false);
 await waitFor(()=>expect(refresh).toHaveBeenCalled());
});

it("keeps confirmed absence separate from pending pricing and links only authorized Draft reviewers to People",async()=>{
 const issue="monthly_proration_jurisdiction_requires_review";
 const earning_groups=[{kind:"earning",code:"monthly_basic",label:"Basic Salary",amount:1800,presentation_model:"monthly_salary_partial_evidence_v1"},{kind:"earning",code:"unpaid_absence",label:"Unpaid Absence",amount:null,presentation_model:"monthly_salary_partial_evidence_v1"}];
 mocks.readCalculation.mockResolvedValue({results:[{employee_id:"employee",status:"review_required",gross_earnings:null,issues:[issue],earning_groups,lines:[]}],adjustments:[]});
 mocks.readPreparation.mockResolvedValue({results:[{employee_id:"employee",projection:{status:"review_required",issues:[issue],earning_groups,lines:[]}}]});
 const {unmount}=render(<PayrollRunEmployeesPanel {...props} canEditEmployee/>);
 await screen.findByText("QA Employee");
 fireEvent.click(screen.getByRole("button",{name:"Review",exact:true}));
 expect(screen.getByText("Confirmed unpaid absence · Deduction pending")).toBeTruthy();
 expect(screen.getByText("Amount pending")).toBeTruthy();
 expect(screen.getByRole("link",{name:"Resolve payroll-period workplace information for QA Employee"}).getAttribute("href")).toBe("/people/employees?employee=employee&section=employment");
 expect(screen.queryByText(/Confirm an effective workplace state/)).toBeNull();
 expect(screen.queryByText(/Updating calculation/)).toBeNull();
 unmount();
 render(<PayrollRunEmployeesPanel {...props} canEditEmployee={false}/>);
 await screen.findByText("QA Employee");
 fireEvent.click(screen.getByRole("button",{name:"Review",exact:true}));
 expect(screen.queryByRole("link",{name:/Resolve payroll-period workplace/})).toBeNull();
});
