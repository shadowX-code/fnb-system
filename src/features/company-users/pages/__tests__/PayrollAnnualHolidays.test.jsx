import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
const service = vi.hoisted(() => ({ readAnnualHolidays: vi.fn(), saveAnnualCalendar: vi.fn(), savePaidHolidayPolicy: vi.fn(), saveDefaultPaidHolidays: vi.fn(), importHolidayCalendar: vi.fn() }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: service }));
vi.mock("../PayrollHolidayImport.jsx", () => ({ default: () => <button>Import Official Calendar</button> }));
import PayrollAnnualHolidays, { annualCalendarEntries } from "../PayrollAnnualHolidays.jsx";
const year = String(new Date().getFullYear());
const required = { id: "required", holiday_date: `${year}-08-31`, name: "Required Holiday", scope: "national", source_note: "Official source", is_active: true };
const optional = { ...required, id: "optional", name: "Optional Holiday", holiday_date: `${year}-05-01` };
const data = { holidays: [required, optional], legal_entities: [{ id: "entity", name: "QA Employer" }], outlets: [] };
const calendar = { id: "calendar", year, revision: 1, status: "published", source_reference: "Official source", source_complete: true,
  entries: [{ holiday_id: required.id, kind: "required", source_reference: "Official source", holiday: required },
    { holiday_id: optional.id, kind: "gazetted", source_reference: "Official source", holiday: optional }] };
beforeEach(() => { vi.clearAllMocks(); service.readAnnualHolidays.mockResolvedValue({ calendars: [calendar], policies: [], can_manage: true }); service.savePaidHolidayPolicy.mockResolvedValue("saved"); });
afterEach(cleanup);
it("does not guess classifications or duplicate entity/outlet holiday definitions", () => {
  expect(annualCalendarEntries([...data.holidays, { ...required, id: "outlet", scope: "outlet" }, { ...required, id: "legacy", legal_entity_id: "entity" }], year)).toHaveLength(2);
  expect(annualCalendarEntries(data.holidays, year).every(e => e.kind === "")).toBe(true);
});
it("locks required selections and publishes one policy shared by canonical entities", async () => {
  render(<PayrollAnnualHolidays data={data} canManage onAddHoliday={vi.fn()} onViewHoliday={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Select Paid Holidays" }));
  const checks = screen.getAllByRole("checkbox");
  const fixed = checks.find(c => c.disabled && c.checked);
  expect(fixed).toBeTruthy();
  expect(screen.queryByLabelText("QA Employer")).toBeNull();
  expect(screen.queryByLabelText("Policy name")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Publish", exact: true }));
  await waitFor(() => expect(service.saveDefaultPaidHolidays).toHaveBeenCalledWith(expect.objectContaining({ selected: ["required"], publish: true })));
  expect(service.savePaidHolidayPolicy).not.toHaveBeenCalled();
});
it("uses the selected immutable calendar snapshot and surfaces source changes without publication", async () => {
  service.readAnnualHolidays.mockResolvedValue({ calendars: [{ ...calendar, id: "new-source", revision: 2 }, calendar], policies: [{ id: "policy", policy_id: "family", is_default: true, status: "published", calendar_version_id: "calendar", selected_holiday_ids: ["required"], legal_entity_ids: ["entity"], outlet_ids: [] }], can_manage: true });
  render(<PayrollAnnualHolidays data={{ ...data, holidays: [{ ...required, name: "Mutable changed name" }] }} canManage />);
  expect(await screen.findByText(/Calendar updated/)).toBeTruthy();
  expect(screen.getByText("Required Holiday")).toBeTruthy();
  expect(screen.queryByText("Mutable changed name")).toBeNull();
  expect(service.saveDefaultPaidHolidays).not.toHaveBeenCalled();
});
it("selects newly required holidays only in the review draft and removes superseded selections", async () => {
  const newRequired = { ...required, id: "new-required", name: "New required holiday" };
  service.readAnnualHolidays.mockResolvedValue({ calendars: [{ ...calendar, id: "new-calendar", entries: [...calendar.entries, { holiday_id: newRequired.id, kind: "required", holiday: newRequired }] }], policies: [{ id: "policy", policy_id: "family", is_default: true, status: "published", calendar_version_id: "old-calendar", selected_holiday_ids: ["required", "removed"], legal_entity_ids: ["entity"], outlet_ids: [] }], can_manage: true });
  render(<PayrollAnnualHolidays data={data} canManage />);
  fireEvent.click(await screen.findByRole("button", { name: "Select Paid Holidays" }));
  expect(screen.getAllByRole("checkbox").filter(c => c.disabled && c.checked)).toHaveLength(2);
  expect(service.saveDefaultPaidHolidays).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Publish", exact: true }));
  await waitFor(() => expect(service.saveDefaultPaidHolidays).toHaveBeenCalledWith(expect.objectContaining({ selected: ["required", "new-required"] })));
});
it("keeps company and outlet scope behind the explicit exception action", async () => {
  render(<PayrollAnnualHolidays data={data} canManage />);
  fireEvent.click(await screen.findByRole("button", { name: "Add Exception" }));
  expect(screen.getByLabelText("QA Employer")).toBeTruthy();
  expect(screen.getByText("Explicit outlet calendar override")).toBeTruthy();
});
it("delegates source imports to the controlled candidate workflow without a second import modal", async () => {
  render(<PayrollAnnualHolidays data={data} canManage />);
  expect(await screen.findByRole("button", { name: "Import Official Calendar" })).toBeTruthy();
  expect(screen.queryByLabelText("Reviewed calendar manifest")).toBeNull();
  expect(service.importHolidayCalendar).not.toHaveBeenCalled();
});
it("requires the company PH benefit setup as well as a published selection for overall Ready", async () => {
  service.readAnnualHolidays.mockResolvedValue({ calendars: [calendar], policies: [{ id: "policy", policy_id: "family", is_default: true, status: "published", calendar_version_id: "calendar", selected_holiday_ids: ["required"], legal_entity_ids: ["entity"], outlet_ids: [] }], can_manage: true, benefit_ready: false });
  const view = render(<PayrollAnnualHolidays data={data} canManage />);
  await screen.findByText("Required Holiday");
  expect(screen.getByText("Setup Required")).toBeTruthy();
  service.readAnnualHolidays.mockResolvedValue({ calendars: [calendar], policies: [{ id: "policy", policy_id: "family", is_default: true, status: "published", calendar_version_id: "calendar", selected_holiday_ids: ["required"], legal_entity_ids: ["entity"], outlet_ids: [] }], can_manage: true, benefit_ready: true });
  view.rerender(<PayrollAnnualHolidays data={{ ...data }} canManage />);
  expect(await screen.findByText("Ready")).toBeTruthy();
});
it("shows real loading/error and blocks policy creation before source publication", async () => {
  service.readAnnualHolidays.mockResolvedValue({ calendars: [], policies: [], can_manage: true });
  render(<PayrollAnnualHolidays data={{ ...data, holidays: [] }} canManage onAddHoliday={vi.fn()} />);
  expect(screen.getByText("Loading annual calendar…")).toBeTruthy();
  expect((await screen.findByRole("button", { name: "Select Paid Holidays" })).disabled).toBe(true);
  expect(screen.getByText(/No dates have been generated/)).toBeTruthy();
});
