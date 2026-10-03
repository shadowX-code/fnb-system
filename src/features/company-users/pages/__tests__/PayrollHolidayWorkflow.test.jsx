// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
const service = vi.hoisted(() => ({ readHolidayOperation: vi.fn(), publishHolidayOperation: vi.fn() }));
const fixture = vi.hoisted(() => ({ candidate: null }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: service }));
vi.mock("../PayrollHolidayImport.jsx", () => ({
  unresolvedHolidayRows: c => c.rows.filter(r => r.state === "blocked" || r.state === "changed" && !c.decisions[r.key]?.remark || r.state === "missing" && c.decisions[r.key]?.action !== "retain"),
  default: function Import({ onCandidateChanged, advancedContent }) { React.useEffect(() => { onCandidateChanged(fixture.candidate); }, [onCandidateChanged]); return <><button>Check Official Updates</button><details><summary>Advanced &amp; History</summary>{advancedContent}</details></>; },
}));
import React from "react";
import PayrollHolidayWorkflow, { operationHolidayRows } from "../PayrollHolidayWorkflow.jsx";
const rows = Array.from({ length: 11 }, (_,i) => ({key:String(i+1),state:"new",classification_review:i<5,row:{date:`2026-01-${String(i+1).padStart(2,"0")}`,name:`Applicable holiday ${i+1}`,scope:i===4?"state":"national",state_code:i===4?"MY-08":null,kind:"gazetted",suggested_kind:i<5?"required":null}}));
const candidate = { id:"candidate",revision:2,proposal_metadata:{document_role:"annual"},rows:[...rows,{key:"12",state:"blocked",row:{date:"2026-02-01",name:"Unrelated KL holiday",scope:"state",state_code:"MY-14",kind:"gazetted"}}],decisions:Object.fromEntries(rows.slice(5).map(r=>[r.key,{action:"accept",origin:"verified_source_extraction"}])) };
beforeEach(()=>{vi.clearAllMocks();fixture.candidate=candidate;service.readHolidayOperation.mockResolvedValue({outlets:[],geographies:["MY-08"],unverified_count:0});service.publishHolidayOperation.mockResolvedValue({calendar_id:"calendar",policy_id:"policy"});});
afterEach(cleanup);
const show = () => render(<PayrollHolidayWorkflow year="2026" annual={{calendars:[],policies:[]}} editable onPublished={vi.fn()} />);
it("takes Perak from official update to one explicit publish without unrelated-state review",async()=>{
 show(); await screen.findByText("Applicable holiday 1");
 expect(screen.queryByText("Unrelated KL holiday")).toBeNull();
 expect(screen.queryByText("Imported")).toBeNull();
 expect(service.publishHolidayOperation).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Select Company Holidays",exact:true}));
 fireEvent.click(screen.getByLabelText(/Confirm these five mandatory/));
 expect(screen.getByText("5/5 mandatory confirmed")).toBeTruthy();
 for(let i=6;i<=11;i++) fireEvent.click(screen.getByLabelText(`Select Applicable holiday ${i}`));
 expect(screen.getByText(/6\/6 company holidays selected/)).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Review Calendar",exact:true}));
 fireEvent.click(screen.getByLabelText(/I reviewed the complete applicable/));
 const publish=screen.getByRole("button",{name:"Publish 2026 Calendar"});
 expect(publish.disabled).toBe(false);fireEvent.click(publish);
 await waitFor(()=>expect(service.publishHolidayOperation).toHaveBeenCalledWith(expect.objectContaining({geography:"MY-08",selected_keys:["6","7","8","9","10","11"],decisions:expect.not.objectContaining({"12":expect.anything()}),reviewed:true})));
});
it("keeps applicable uncertainty blocking even when the paid selection is complete",async()=>{
 fixture.candidate={...candidate,rows:[...candidate.rows,{key:"13",state:"blocked",issue:"Date conditional",row:{date:"2026-03-01",name:"Conditional Perak date",scope:"state",state_code:"MY-08",kind:"gazetted"}}]};
 show();await screen.findByText("Conditional Perak date");
 fireEvent.click(screen.getByRole("button",{name:"Select Company Holidays",exact:true}));fireEvent.click(screen.getByLabelText(/Confirm these five mandatory/));
 for(let i=6;i<=11;i++)fireEvent.click(screen.getByLabelText(`Select Applicable holiday ${i}`));
 fireEvent.click(screen.getByRole("button",{name:"Review Calendar",exact:true}));fireEvent.click(screen.getByLabelText(/I reviewed the complete applicable/));
 expect(screen.getByRole("button",{name:"Publish 2026 Calendar"}).disabled).toBe(true);
 expect(service.publishHolidayOperation).not.toHaveBeenCalled();
});
it("does not infer Perak when statutory geography is missing",async()=>{
 service.readHolidayOperation.mockResolvedValue({outlets:[],geographies:[],unverified_count:4});show();
 expect(await screen.findByText(/Statutory geography is missing/)).toBeTruthy();expect(screen.queryByText("Applicable holiday 1")).toBeNull();
});
it("uses canonical snapshot classifications and keeps missing historical evidence visible",()=>{
 const mapped=operationHolidayRows({rows:[{key:"a",state:"missing",previous:{kind:"required",holiday:{name:"Retained",holiday_date:"2026-01-01",scope:"state",state_code:"MY-08"}}}]},null,"MY-08");
 expect(mapped[0]).toMatchObject({kind:"required",uncertain:true,name:"Retained"});
});

it("shows additional gazetted entitlements separately from six company choices",async()=>{
 fixture.candidate=null;
 const entries=rows.map((r,i)=>({holiday_id:r.key,kind:i<5?"required":"gazetted",holiday:{holiday_date:r.row.date,name:r.row.name,scope:r.row.scope,state_code:r.row.state_code}}));
 render(<PayrollHolidayWorkflow year="2026" annual={{calendars:[{id:"calendar",status:"published",entries}],policies:[{id:"policy",is_default:true,selected_holiday_ids:rows.map(r=>r.key)}],additional_entries:[{holiday_id:"extra",holiday:{holiday_date:"2026-03-20",name:"Extra gazette",scope:"state",state_code:"MY-08"}}]}} editable onPublished={vi.fn()} />);
 await screen.findByText("Applicable holiday 1");fireEvent.click(screen.getByRole("button",{name:"Select Company Holidays",exact:true}));
 expect(screen.getByText(/6\/6 company holidays selected/)).toBeTruthy();expect(screen.getByText("Extra gazette")).toBeTruthy();expect(screen.queryByLabelText("Select Extra gazette")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Review Calendar",exact:true}));
 expect(screen.getByText("Total Paid Holidays").parentElement.textContent).toContain("12");
});

it("does not borrow one known workplace state for other unverified workplaces",async()=>{
 service.readHolidayOperation.mockResolvedValue({outlets:[],geographies:["MY-08"],unverified_count:4});show();
 await screen.findByText(/Statutory geography is missing/);expect(screen.queryByText("Perak · 2026")).toBeNull();expect(screen.queryByText("Applicable holiday 1")).toBeNull();
});
