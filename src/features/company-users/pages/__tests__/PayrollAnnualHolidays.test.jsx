import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
const service = vi.hoisted(() => ({ readAnnualHolidays: vi.fn(), saveAnnualCalendar: vi.fn(), savePaidHolidayPolicy: vi.fn(), saveDefaultPaidHolidays: vi.fn() }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: service }));
vi.mock("../PayrollHolidayImport.jsx", () => ({ default: () => <button>Get Official Calendar</button> }));
import PayrollAnnualHolidays, { annualCalendarEntries } from "../PayrollAnnualHolidays.jsx";
const year = String(new Date().getFullYear());
const holidays = Array.from({ length: 12 }, (_, i) => ({ id: `holiday-${i}`, holiday_date: `${year}-01-${String(i + 1).padStart(2, "0")}`, name: `Holiday ${i}`, scope: "national", source_note: "Verified source", is_active: true }));
const entries = holidays.map((holiday, i) => ({ holiday_id: holiday.id, kind: i < 5 ? "required" : "gazetted", source_reference: "Verified source", holiday }));
const calendar = { id: "calendar", year, revision: 1, status: "published", source_reference: "Verified source", entries };
const data = { holidays, legal_entities: [{ id: "entity", name: "Employer" }], outlets: [] };
const policy = { id: "policy", policy_id: "family", is_default: true, status: "published", calendar_version_id: "calendar", selected_holiday_ids: holidays.slice(0, 11).map(h => h.id), legal_entity_ids: ["entity"], outlet_ids: [] };
beforeEach(() => { vi.clearAllMocks(); service.readAnnualHolidays.mockResolvedValue({ calendars: [calendar], policies: [], can_manage: true }); service.saveDefaultPaidHolidays.mockResolvedValue("saved"); });
afterEach(cleanup);
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
