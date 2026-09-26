import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
const service = vi.hoisted(() => ({ readAnnualHolidays: vi.fn(), saveAnnualCalendar: vi.fn(), savePaidHolidayPolicy: vi.fn(), saveDefaultPaidHolidays: vi.fn(), importHolidayCalendar: vi.fn() }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: service }));
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
it("keeps company and outlet scope behind the explicit exception action", async () => {
  render(<PayrollAnnualHolidays data={data} canManage />);
  fireEvent.click(await screen.findByRole("button", { name: "Add Exception" }));
  expect(screen.getByLabelText("QA Employer")).toBeTruthy();
  expect(screen.getByText("Explicit outlet calendar override")).toBeTruthy();
});
it("previews a reviewed import and sends it only after explicit publication", async () => {
  render(<PayrollAnnualHolidays data={data} canManage />);
  fireEvent.click(await screen.findByRole("button", { name: "Import Calendar" }));
  const manifest = { source_reference: "Reviewed annual gazette", source_complete: true, holidays: [{ date: `${year}-08-31`, name: "Sourced Holiday", scope: "national", kind: "required" }] };
  fireEvent.change(screen.getByLabelText("Reviewed calendar manifest"), { target: { files: [{ size: 400, text: async () => JSON.stringify(manifest) }] } });
  await screen.findByText("Sourced Holiday");
  expect(service.importHolidayCalendar).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Publish", exact: true }));
  await waitFor(() => expect(service.importHolidayCalendar).toHaveBeenCalledWith(expect.objectContaining({ year, manifest, publish: true })));
  expect(service.saveDefaultPaidHolidays).not.toHaveBeenCalled();
});
it("does not publish incomplete source or substitute fake dates for an invalid file", async () => {
  render(<PayrollAnnualHolidays data={data} canManage />);
  fireEvent.click(await screen.findByRole("button", { name: "Import Calendar" }));
  fireEvent.change(screen.getByLabelText("Reviewed calendar manifest"), { target: { files: [{ size: 10, text: async () => "{}" }] } });
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Publish", exact: true }).disabled).toBe(true);
  expect(service.importHolidayCalendar).not.toHaveBeenCalled();
});
it("shows real loading/error and blocks policy creation before source publication", async () => {
  service.readAnnualHolidays.mockResolvedValue({ calendars: [], policies: [], can_manage: true });
  render(<PayrollAnnualHolidays data={{ ...data, holidays: [] }} canManage onAddHoliday={vi.fn()} />);
  expect(screen.getByText("Loading annual calendar…")).toBeTruthy();
  expect((await screen.findByRole("button", { name: "Select Paid Holidays" })).disabled).toBe(true);
  expect(screen.getByText(/No dates have been generated/)).toBeTruthy();
});
