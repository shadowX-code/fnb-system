import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import OutletEmploymentLawCoverage from "../OutletEmploymentLawCoverage.jsx";
const api = vi.hoisted(() => ({ readEmploymentLawCoverage: vi.fn(), confirmEmploymentLawCoverage: vi.fn() }));
vi.mock("../../../../services/outletService.js", () => ({ outletService: api }));
vi.mock("../../../../components/forms/SelectField.jsx", () => ({ default: ({ label, value, options, onChange, disabled }) => <label>{label}<select aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}><option value="" />{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label> }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const record = { id:"prior",effective_from:"2026-09-01",coverage:"unresolved",actor_name:"Admin",recorded_at:"2026-10-06",reference:"Existing evidence",reason:"Missing coverage" };
function fill() {
 fireEvent.change(screen.getByLabelText("Employment law coverage"), {target:{value:"peninsular_labuan"}});
 fireEvent.change(screen.getByLabelText("Effective from"), {target:{value:"2026-09-01"}});
 fireEvent.change(screen.getByLabelText("Evidence / reference"), {target:{value:"Verified historical contract"}});
 fireEvent.change(screen.getByLabelText("Confirmation / correction reason"), {target:{value:"Historical confirmation"}});
}
describe("Outlet employment law coverage", () => {
 it("requires explicit dated evidence, binds the prior revision, and retains retry identity after a lost response", async () => {
  api.readEmploymentLawCoverage.mockResolvedValue({current:{coverage:"unresolved"},history:[record],can_confirm:true});
  api.confirmEmploymentLawCoverage.mockRejectedValueOnce(new Error("Network response lost")).mockResolvedValueOnce("new");
  render(<OutletEmploymentLawCoverage outlet={{id:"outlet",name:"QA Workplace"}} onClose={vi.fn()} />);
  await screen.findByLabelText("Effective from");
  expect(screen.getByRole("button",{name:"Confirm Coverage"}).disabled).toBe(true);
  expect(screen.getByLabelText("Effective from").value).toBe("");
  expect(screen.getByLabelText("Employment law coverage").value).toBe("");
  fill(); fireEvent.click(screen.getByRole("button",{name:"Confirm Coverage"}));
  await screen.findByText("Network response lost");
  fireEvent.click(screen.getByRole("button",{name:"Confirm Coverage"}));
  await waitFor(() => expect(api.confirmEmploymentLawCoverage).toHaveBeenCalledTimes(2));
  const [first,second] = api.confirmEmploymentLawCoverage.mock.calls;
  expect(first).toEqual(second);
  expect(first[0]).toBe("outlet"); expect(first[3]).toBe("prior");
  expect(first[1]).toMatchObject({effective_from:"2026-09-01",coverage:"peninsular_labuan"});
  await waitFor(() => expect(screen.getByLabelText("Effective from").value).toBe(""));
 });
 it("read-only access preserves original history without presenting confirmation", async () => {
  api.readEmploymentLawCoverage.mockResolvedValue({current:{coverage:"sarawak",effective_from:"2026-10-03"},history:[record],can_confirm:false});
  render(<OutletEmploymentLawCoverage outlet={{id:"outlet",name:"QA Workplace"}} onClose={vi.fn()} />);
  await screen.findByText(/Sarawak/);
  expect(screen.queryByRole("button",{name:"Confirm Coverage"})).toBeNull();
  expect(screen.getByText(/Existing evidence/)).toBeTruthy();
 });
});
