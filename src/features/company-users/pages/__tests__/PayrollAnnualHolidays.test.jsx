import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
const service = vi.hoisted(() => ({ readAnnualHolidays: vi.fn(), saveAnnualCalendar: vi.fn(), savePaidHolidayPolicy: vi.fn(), saveDefaultPaidHolidays: vi.fn() }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: service }));
vi.mock("../PayrollHolidayWorkflow.jsx", () => ({ default: ({ advancedContent, editable }) => editable ? <><button>Check Official Updates</button><details><summary>Advanced &amp; History</summary>{advancedContent}</details></> : null }));
import PayrollAnnualHolidays, { annualCalendarEntries } from "../PayrollAnnualHolidays.jsx";
const year = String(new Date().getFullYear());
const holidays = Array.from({ length: 12 }, (_, i) => ({ id: `holiday-${i}`, holiday_date: `${year}-01-${String(i + 1).padStart(2, "0")}`, name: `Holiday ${i}`, scope: "national", source_note: "Verified source", is_active: true }));
const entries = holidays.map((holiday, i) => ({ holiday_id: holiday.id, kind: i < 5 ? "required" : "gazetted", source_reference: "Verified source", holiday }));
const calendar = { id: "calendar", year, revision: 1, status: "published", source_reference: "Verified source", entries };
const data = { holidays, legal_entities: [{ id: "entity", name: "Employer" }], outlets: [] };
const policy = { id: "policy", policy_id: "family", is_default: true, status: "published", calendar_version_id: "calendar", selected_holiday_ids: holidays.slice(0, 11).map(h => h.id), legal_entity_ids: ["entity"], outlet_ids: [] };
beforeEach(() => { vi.clearAllMocks(); service.readAnnualHolidays.mockResolvedValue({ calendars: [calendar], policies: [], can_manage: true }); service.saveDefaultPaidHolidays.mockResolvedValue("saved"); });
afterEach(cleanup);
it("groups maintenance and complete version history under one secondary entry", async () => {
  service.readAnnualHolidays.mockResolvedValue({ calendars: [calendar], policies: [{ ...policy, revision: 2 }, { ...policy, id: "older-policy", revision: 1 }], can_manage: true });
  render(<PayrollAnnualHolidays data={data} canManage />);
  await screen.findByText("Advanced & History");
  expect(screen.getAllByText("Advanced & History")).toHaveLength(1);
  expect(screen.queryByText("Advanced · Classification maintenance")).toBeNull();
  expect(screen.queryByText("View details / History")).toBeNull();
  expect(screen.getByRole("region", { name: "Calendar Maintenance" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Holiday History" }).textContent).toContain("Revision 1");
  expect(screen.getAllByRole("button", { name: "Override Classification" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "Add Sourced Holiday" })).toHaveLength(1);
  expect(screen.getByText("Manage exceptions")).toBeTruthy();
});
it("retains read-only history without exposing maintenance authority", async () => {
  render(<PayrollAnnualHolidays data={data} canManage={false} />);
  await screen.findByText("Advanced & History");
  expect(screen.getAllByText("Advanced & History")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Override Classification" })).toBeNull();
  expect(screen.getByText("Calendar versions / Publication history")).toBeTruthy();
});
it("retains verified annual classifications without a normal reclassification workflow", async () => {
  render(<PayrollAnnualHolidays data={data} canManage />);
  await screen.findByText("Advanced & History");

  expect(screen.queryByRole("button", { name: "Resolve Calendar Exceptions" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Override Classification" }));
  expect(screen.getByRole("heading", { name: "Override Holiday Classification" })).toBeTruthy();
  expect(screen.getByLabelText(/Override reason/)).toBeTruthy();
  expect(screen.getAllByText(/^Classification —/)).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Publish", exact: true }).disabled).toBe(true);
  expect(service.saveAnnualCalendar).not.toHaveBeenCalled();
});
it("does not infer classifications or duplicate entity/outlet definitions", () => {
  expect(annualCalendarEntries([...holidays, { ...holidays[0], id: "outlet", scope: "outlet" }, { ...holidays[0], id: "legacy", legal_entity_id: "entity" }], year)).toHaveLength(12);
  expect(annualCalendarEntries(holidays, year).every(e => !e.kind)).toBe(true);
});
it("keeps company and outlet scope behind explicit exceptions", async () => {
  render(<PayrollAnnualHolidays data={data} canManage />);
  fireEvent.click(await screen.findByRole("button", { name: "Add Exception" }));
  expect(screen.getByLabelText("Employer")).toBeTruthy();
  expect(screen.getByText("Explicit outlet calendar override")).toBeTruthy();
});
