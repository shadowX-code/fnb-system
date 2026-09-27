import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(()=>({readInitialSetup:vi.fn(),confirmInitialSetup:vi.fn()}));
vi.mock("../../../../services/payrollService.js",()=>({payrollService:mocks}));
import { FoundationForm } from "../PayrollPage.jsx";
import { readFileSync } from "node:fs";
const data={employees:[{id:"qa",name:"QA",legal_entity_id:"le",joined_date:"2026-05-01"}],profiles:[],legal_entities:[{id:"le",name:"QA Employer"}]};
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.readInitialSetup.mockImplementation(async(id,date,a)=>({fingerprint:"trusted",evidence:{},schemes:{
    epf:{recommendation:a.epf?"malaysian_under_60":null},socso:{recommendation:a.socso?"first_category_base":null},eis:{recommendation:a.eis?"standard":null},pcb:{}
  }}));
  mocks.confirmInitialSetup.mockResolvedValue({});
});
afterEach(cleanup);
async function choose(name,value) {
  fireEvent.click(screen.getByRole("button",{name}));
  fireEvent.click(screen.getByRole("button",{name:value,exact:true}));
  await waitFor(()=>expect(screen.queryByText("Checking Employee evidence…")).toBeNull());
}
it("confirms pay, applicability and server recommendations in one save without free text",async()=>{
  const saved=vi.fn();
  render(<FoundationForm mode="create" initialEmployeeId="qa" data={data} onClose={vi.fn()} onSaved={saved}/>);
  fireEvent.change(screen.getByRole("spinbutton"),{target:{value:"2000"}});
  await choose("EPF","Applicable");
  await choose("SOCSO","Applicable");
  await choose("EIS","Applicable");
  await choose("PCB","Not Applicable");
  expect(screen.getByText("Malaysian · under 60 · Recommended")).toBeTruthy();
  expect(screen.getByText("Act 4 · First Category · Recommended")).toBeTruthy();
  expect(screen.queryByLabelText("Reason / provenance")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Confirm Employee Setup"}));
  await waitFor(()=>expect(saved).toHaveBeenCalled());
  expect(mocks.confirmInitialSetup).toHaveBeenCalledWith(expect.objectContaining({
    employeeId:"qa",rate:2000,fingerprint:"trusted",applicability:{epf:true,socso:true,eis:true,pcb:false}
  }));
});
it("allows truthful unresolved setup and reevaluates Off to On",async()=>{
  mocks.readInitialSetup.mockImplementation(async(id,date,a)=>({fingerprint:"trusted",schemes:{epf:{issue:"birthdate_unverified"},socso:{},eis:{},pcb:{}},evidence:{}}));
  render(<FoundationForm mode="create" initialEmployeeId="qa" data={data} onClose={vi.fn()} onSaved={vi.fn()}/>);
  fireEvent.change(screen.getByRole("spinbutton"),{target:{value:"2000"}});
  for(const name of ["EPF","SOCSO","EIS","PCB"]) await choose(name,"Not Applicable");
  await choose("EPF","Applicable");
  expect(await screen.findByText("Additional information required")).toBeTruthy();
  expect(screen.getByText(/Confirm a valid date of birth/)).toBeTruthy();
  expect(screen.getByRole("button",{name:"Confirm Employee Setup"}).disabled).toBe(false);
  expect(mocks.readInitialSetup).toHaveBeenLastCalledWith("qa","2026-05-01",{epf:true,socso:false,eis:false,pcb:false},expect.stringMatching(/^\d{4}-\d{2}-01$/));
});
it("keeps one private resolver and an atomic scoped append-only initial command",()=>{
  const sql=readFileSync("supabase/migrations/20260926115140_payroll_initial_statutory_setup.sql","utf8");
  expect(sql.match(/recommendation:=case/g)).toHaveLength(1);
  expect(sql).toContain("payroll_statutory_setup_core(");
  expect(sql).toContain("for update");
  expect(sql).toContain("payroll_can_access_employee(p_employee_id,'payroll.manage')");
  expect(sql).toContain("r->>'fingerprint' is distinct from p_fingerprint");
  expect(sql).toContain("profile_id:=public.payroll_profile_create");
  expect(sql).toContain("category_id:=public.payroll_statutory_input_adjust");
  expect(sql).toContain("from public,anon,authenticated");
});
it("recommends joined date and warns only when Admin selects a genuinely later pay date",async()=>{
  render(<FoundationForm mode="create" initialEmployeeId="qa" data={data} onClose={vi.fn()} onSaved={vi.fn()}/>);
  expect(screen.getByRole("textbox",{name:/Pay Effective From/}).value).toContain("May");
  expect(screen.queryByText(/Current pay starts after employment date/)).toBeNull();
  fireEvent.change(screen.getByRole("textbox",{name:/Pay Effective From/}),{target:{value:"26 Sep 2026"}});
  expect(await screen.findByText(/Current pay starts after employment date/)).toBeTruthy();
});
it("recommends the exact mid-month joined date without conflating statutory month",()=>{
  render(<FoundationForm mode="create" initialEmployeeId="qa" data={{...data,employees:[{...data.employees[0],joined_date:"2026-10-15"}]}} onClose={vi.fn()} onSaved={vi.fn()}/>);
  expect(screen.getByRole("textbox",{name:/Pay Effective From/}).value).toBe("15 Oct 2026");
  expect(screen.getByRole("button",{name:"Effective Payroll Month"})).toBeTruthy();
});
