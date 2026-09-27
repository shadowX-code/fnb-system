import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
const service = vi.hoisted(() => ({ readAnnualHolidays: vi.fn(), saveAnnualCalendar: vi.fn(), savePaidHolidayPolicy: vi.fn(), saveDefaultPaidHolidays: vi.fn() }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: service }));
vi.mock("../PayrollHolidayImport.jsx", () => ({ default: ({ advancedContent }) => <><button>Check Official Updates</button><details><summary>Advanced &amp; History</summary>{advancedContent}</details></> }));
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
  await screen.findByText(/Calendar verified/);
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
  await screen.findByText(/Calendar verified/);
  expect(screen.getAllByText("Advanced & History")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Override Classification" })).toBeNull();
  expect(screen.getByText("Calendar versions / Publication history")).toBeTruthy();
});
it("retains verified annual classifications without a normal reclassification workflow", async () => {
  render(<PayrollAnnualHolidays data={data} canManage />);
  await screen.findByText(/Calendar verified/);
  expect(screen.queryByRole("button", { name: "Review Calendar" })).toBeNull();
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
it("locks required selections and publishes inline without a policy-name form", async () => {
  render(<PayrollAnnualHolidays data={data} canManage />);
  await screen.findByText("Holiday 0");
  expect(screen.getAllByRole("checkbox").filter(c => c.disabled && c.checked)).toHaveLength(5);
  expect(screen.getByRole("button", { name: "Publish Paid Holiday Selection" }).disabled).toBe(true);
  for (let i = 5; i < 11; i++) fireEvent.click(screen.getByLabelText(`Select Holiday ${i}`));
  expect(screen.queryByLabelText("Policy name")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Publish Paid Holiday Selection" }));
  await waitFor(() => expect(service.saveDefaultPaidHolidays).toHaveBeenCalledWith(expect.objectContaining({ calendarId: "calendar", selected: holidays.slice(0, 11).map(h => h.id), publish: true })));
});
it("uses immutable calendar snapshots and surfaces source changes without publishing", async () => {
  service.readAnnualHolidays.mockResolvedValue({ calendars: [{ ...calendar, id: "new-source" }, calendar], policies: [policy], can_manage: true });
  render(<PayrollAnnualHolidays data={{ ...data, holidays: [{ ...holidays[0], name: "Mutable changed name" }] }} canManage />);
  expect(await screen.findByText(/Calendar updated/)).toBeTruthy();
  expect(screen.getByText("Holiday 0")).toBeTruthy();
  expect(screen.queryByText("Mutable changed name")).toBeNull();
  expect(service.saveDefaultPaidHolidays).not.toHaveBeenCalled();
});
it("keeps company and outlet scope behind explicit exceptions", async () => {
  render(<PayrollAnnualHolidays data={data} canManage />);
  fireEvent.click(await screen.findByRole("button", { name: "Add Exception" }));
  expect(screen.getByLabelText("Employer")).toBeTruthy();
  expect(screen.getByText("Explicit outlet calendar override")).toBeTruthy();
});
it("identifies the next task and requires benefit setup as well as published selection", async () => {
  service.readAnnualHolidays.mockResolvedValue({ calendars: [calendar], policies: [policy], can_manage: true, benefit_ready: false });
  const view = render(<PayrollAnnualHolidays data={data} canManage />);
  expect(await screen.findByText("PH Work Benefit not configured")).toBeTruthy();
  expect(screen.getByText("Paid holiday selection published")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Publish Paid Holiday Selection" })).toBeNull();
  service.readAnnualHolidays.mockResolvedValue({ calendars: [calendar], policies: [policy], can_manage: true, benefit_ready: true });
  view.rerender(<PayrollAnnualHolidays data={{ ...data }} canManage />);
  expect(await screen.findByText("Ready")).toBeTruthy();
});
it("starts an empty year without inventing dates or enabling paid selection", async () => {
  service.readAnnualHolidays.mockResolvedValue({ calendars: [], policies: [], can_manage: true });
  render(<PayrollAnnualHolidays data={{ ...data, holidays: [] }} canManage />);
  expect(await screen.findByText("Official Calendar not published")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Publish Paid Holiday Selection" })).toBeNull();
});
it("counts additional mandatory holidays separately without consuming six choices", async () => {
  const extra = { holiday_id: "additional", kind: "additional_mandatory", holiday: { id: "additional", name: "Additional declaration", holiday_date: `${year}-03-20`, scope: "state", state_code: "MY-08" } };
  service.readAnnualHolidays.mockResolvedValue({ calendars: [calendar], policies: [], additional_entries: [extra], can_manage: true });
  render(<PayrollAnnualHolidays data={data} canManage />);
  expect(await screen.findByText("Additional Gazetted — locked")).toBeTruthy();
  expect(screen.getByLabelText("Select Additional declaration").checked).toBe(true);
  expect(screen.getByLabelText("Select Additional declaration").disabled).toBe(true);
  expect(screen.getAllByText("Select 6 more paid holidays")).toHaveLength(2);
  for (let i = 5; i < 11; i++) fireEvent.click(screen.getByLabelText(`Select Holiday ${i}`));
  expect(screen.getByLabelText("Select Holiday 11").disabled).toBe(false);
  const total = screen.getByText("Total Paid Holidays").parentElement;
  expect(total.textContent).toContain("12");
  fireEvent.click(screen.getByRole("button", { name: "Publish Paid Holiday Selection" }));
  await waitFor(() => expect(service.saveDefaultPaidHolidays).toHaveBeenCalledWith(expect.objectContaining({ selected: holidays.slice(0, 11).map(h => h.id) })));
});
