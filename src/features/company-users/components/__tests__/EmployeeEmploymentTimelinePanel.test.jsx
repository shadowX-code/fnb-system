// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());
vi.mock("../../../../services/employeeEmploymentService.js", () => ({ employeeEmploymentService: { read, save } }));
vi.mock("../../../../components/feedback/Modal.jsx", () => ({ default: ({ title, children, footer }) => <div role="dialog" aria-label={title}>{children}{footer}</div> }));
vi.mock("../../../../components/forms/DatePickerField.jsx", () => ({ default: ({ label, value, onChange }) => <input aria-label={label} type="date" value={value} onChange={(event) => onChange(event.target.value)} /> }));
vi.mock("../../../../components/forms/SelectField.jsx", () => ({ default: ({ label, value, onChange, options }) => <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{!options.some((option) => option.value === "") && <option value="">Select</option>}{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));

import EmployeeEmploymentTimelinePanel from "../EmployeeEmploymentTimelinePanel.jsx";

const baseline = { id: "baseline", employment_type: "part_time", employment_status: "active", position: "Service Crew", legal_entity_id: "employer", workplace: "JYMT Kopitiam", effective_from: "2026-09-29" };
const props = { employeeId: "employee", joinedDate: "2026-09-26", canEdit: true,
  positions: [{ name: "Service Crew" }], workplaces: ["JYMT Kopitiam", "Friends Corner"],
  legalEntities: [{ id: "employer", is_active: true, display_name: "Employer" }] };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T04:00:00Z"));
  read.mockImplementation(async (_employeeId, asOf) => asOf < "2026-09-29"
    ? { state: "unresolved", as_of: asOf, verified_from: "2026-09-29", assignment: null, revisions: [baseline] }
    : { state: "resolved", as_of: asOf, verified_from: "2026-09-29", assignment: baseline, revisions: [baseline] });
  save.mockResolvedValue({ projection_state: "current" });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

describe("Change Employment historical baseline", () => {
  it("requires an explicitly completed earlier assignment and submits null expected revision", async () => {
    render(<EmployeeEmploymentTimelinePanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Change Employment" }));
    fireEvent.change(screen.getByLabelText("Effective from"), { target: { value: "2026-09-26" } });
    await screen.findByText("Historical employment correction");
    expect(screen.getByRole("button", { name: "Confirm Historical Employment" }).disabled).toBe(true);
    expect(screen.getByText(/Select Employment Type, Employment Status, Position, Workplace/)).toBeTruthy();
    for (const [label, value] of [["Employment Type", "part_time"], ["Employment Status", "active"], ["Position", "Service Crew"], ["Legal Employer", "employer"], ["Workplace", "JYMT Kopitiam"]]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.change(screen.getByPlaceholderText("Why is this assignment changing?"), { target: { value: "Verified from joining records" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Evidence \/ reference/ }), { target: { value: "HR record 26 Sep" } });
    const confirm = screen.getByRole("button", { name: "Confirm Historical Employment" });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      employeeId: "employee", effectiveFrom: "2026-09-26", expectedRevisionId: null,
      assignment: { employment_type: "part_time", employment_status: "active", position: "Service Crew", legal_entity_id: "employer", workplace: "JYMT Kopitiam", employment_jurisdiction: "" },
      reason: "Verified from joining records", evidenceReference: "HR record 26 Sep",
    })));
  });

  it("blocks an earlier date than Joined Date with a specific explanation", async () => {
    render(<EmployeeEmploymentTimelinePanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Change Employment" }));
    fireEvent.change(screen.getByLabelText("Effective from"), { target: { value: "2026-09-25" } });
    await screen.findByText(/Effective date cannot precede this employee’s Joined Date/);
    expect(screen.getByRole("button", { name: "Confirm Historical Employment" }).disabled).toBe(true);
  });
});

it("confirms jurisdiction through the existing complete employment correction command", async () => {
 render(<EmployeeEmploymentTimelinePanel {...props} />);
 fireEvent.click(screen.getByRole("button", { name: "Change Employment" }));
 const control=await screen.findByLabelText("Employment Jurisdiction");
 fireEvent.change(control,{target:{value:"peninsular_labuan"}});
 fireEvent.change(screen.getByPlaceholderText("Why is this assignment changing?"),{target:{value:"Verified applicable employment law"}});
 fireEvent.click(screen.getByRole("button",{name:"Confirm Employment Change"}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith(expect.objectContaining({expectedRevisionId:"baseline",assignment:expect.objectContaining({employment_jurisdiction:"peninsular_labuan",workplace:"JYMT Kopitiam"})})));
});
