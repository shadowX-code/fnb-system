import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
import FactoryMestiCleaningPage from "../FactoryMestiCleaningPage.jsx";
import { factoryService } from "../../../../services/factoryService.js";

vi.mock("../../../../services/factoryService.js", () => ({ factoryService: {
  listMestiCleaningDay: vi.fn(), listMestiCleaningMonth: vi.fn(), saveMestiCleaningRequirement: vi.fn(), completeMestiCleaningOccurrence: vi.fn(), verifyMestiCleaningOccurrence: vi.fn(),
} }));

const locationPreparation = { id: "loc-prep", location_name: "Preparation", status: "active", is_storage_location: false };
const locationCooking = { id: "loc-cook", location_name: "Cooking", status: "active", is_storage_location: false };
const locationDryStore = { id: "loc-store", location_name: "Dry Store", status: "active", is_storage_location: true };
const floorOccurrence = { id: "occ-floor-prep", due_date: "2026-09-02", status: "pending", requirement_id: "req-floor-v4", logical_requirement_id: "logical-floor", location_id: "loc-prep", location_name: "Preparation", task_name: "Floor", recurrence_type: "weekly", recurrence_weekdays: [3] };
const floorCooking = { ...floorOccurrence, id: "occ-floor-cook", location_id: "loc-cook", location_name: "Cooking", status: "verified", verified_by_name: "Isaac", verified_at: "2026-09-02T03:00:00Z" };
const drainOccurrence = { ...floorOccurrence, id: "occ-drain-cook", requirement_id: "req-drain", logical_requirement_id: "logical-drain", location_id: "loc-cook", location_name: "Cooking", task_name: "Drain", recurrence_type: "daily", recurrence_weekdays: [] };
const monthlyRows = [
  { requirement_id: "req-floor-v4", logical_requirement_id: "logical-floor", version_no: 4, task_name: "Floor", recurrence_type: "weekly", recurrence_weekdays: [3], days: [{ due_date: "2026-09-02", status: "mixed", total_count: 2, verified_count: 1, completed_count: 0, unsatisfactory_count: 0, missed_count: 0, pending_count: 1, occurrences: [floorCooking, floorOccurrence] }] },
  { requirement_id: "req-floor-other", logical_requirement_id: "logical-floor-other", version_no: 1, task_name: "Floor", recurrence_type: "daily", recurrence_weekdays: [], days: [{ due_date: "2026-09-02", status: "unsatisfactory", total_count: 1, verified_count: 0, completed_count: 0, unsatisfactory_count: 1, missed_count: 0, pending_count: 0, occurrences: [{ ...drainOccurrence, id: "occ-floor-other", task_name: "Floor", logical_requirement_id: "logical-floor-other", status: "unsatisfactory" }] }] },
  { requirement_id: "req-drain", logical_requirement_id: "logical-drain", version_no: 1, task_name: "Drain", recurrence_type: "daily", recurrence_weekdays: [], days: [{ due_date: "2026-09-02", status: "completed", total_count: 1, verified_count: 0, completed_count: 1, unsatisfactory_count: 0, missed_count: 0, pending_count: 0, occurrences: [drainOccurrence] }] },
];
const data = {
  storageLocations: [locationPreparation, locationCooking, locationDryStore],
  mestiCleaningRequirements: [
    { id: "req-floor-v5", logical_requirement_id: "logical-floor", task_name: "Floor", location_ids: ["loc-prep", "loc-cook", "loc-store"], location_names: ["Preparation", "Cooking", "Dry Store"], recurrence_type: "weekly", recurrence_weekdays: [3], status: "active", effective_from: "2026-09-01", version_no: 5 },
    { id: "req-wall", logical_requirement_id: "logical-wall", task_name: "Wall", location_ids: ["loc-cook"], location_names: ["Cooking"], recurrence_type: "weekly", recurrence_weekdays: [3], status: "active", effective_from: "2026-09-01", version_no: 1 },
  ],
};

function monthWith(occurrence) {
  return [{ ...monthlyRows[0], days: [{ ...monthlyRows[0].days[0], status: occurrence.status === "verified" ? "verified" : "mixed", verified_count: occurrence.status === "verified" ? 2 : 1, completed_count: occurrence.status === "completed" ? 1 : 0, pending_count: 0, occurrences: [floorCooking, occurrence] }] }];
}

function renderPage({ permissions = ["factory_mesti_cleaning.view", "factory_mesti_cleaning.complete", "factory_mesti_cleaning.review"] } = {}) {
  const can = (permission) => permissions.includes(permission);
  return render(<FactoryPermissionsProvider permissionSet={permissions} can={can}><FactoryMasterDataProvider data={data}><FactoryMestiCleaningPage auth={{ profile: { id: "employee-1" } }} onNotify={vi.fn()} /></FactoryMasterDataProvider></FactoryPermissionsProvider>);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-02T04:00:00Z"));
  vi.resetAllMocks();
  factoryService.listMestiCleaningDay.mockResolvedValue([floorOccurrence, drainOccurrence]);
  factoryService.listMestiCleaningMonth.mockResolvedValue(monthlyRows);
  factoryService.completeMestiCleaningOccurrence.mockResolvedValue({});
  factoryService.verifyMestiCleaningOccurrence.mockResolvedValue({});
  factoryService.saveMestiCleaningRequirement.mockImplementation(async (value) => ({ id: "req-new", logical_requirement_id: "logical-new", ...value, location_names: ["Preparation", "Dry Store"], version_no: 1 }));
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Factory MeSTI Cleaning of Area", () => {
  it("keeps view-specific content behind canonical tabs and loads the selected month without a manual Load action", async () => {
    renderPage();
    expect((await screen.findAllByText("Due")).length).toBeGreaterThan(0);
    expect(screen.getByRole("tablist", { name: "View" })).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Monthly" }));
    await waitFor(() => expect(factoryService.listMestiCleaningMonth).toHaveBeenCalled());
    expect(screen.queryByText("Due", { selector: "div" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Load" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
    expect(screen.queryByText("Legend")).toBeNull();
    expect(screen.queryByText("Due")).toBeNull();
  });

  it("keeps Daily Location-centric and lets the canonical complete permission complete work", async () => {
    renderPage();
    expect(await screen.findByText("Preparation")).not.toBeNull();
    expect(screen.getByText("Cooking")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "View details" })).toBeNull();
    const pendingBadges = screen.getAllByText("Pending").map((node) => node.closest(".badge")).filter(Boolean);
    expect(pendingBadges).not.toHaveLength(0);
    pendingBadges.forEach((badge) => expect(badge.querySelectorAll("svg")).toHaveLength(1));
    fireEvent.click(screen.getAllByRole("button", { name: /complete/i })[0]);
    await waitFor(() => expect(factoryService.completeMestiCleaningOccurrence).toHaveBeenCalledWith("occ-floor-prep"));
  });

  it("lets the canonical review permission review work regardless of completing actor", async () => {
    factoryService.listMestiCleaningDay.mockResolvedValue([{ ...floorOccurrence, status: "completed", completed_by: "employee-2", completed_by_name: "Aisha", completed_at: "2026-09-02T02:00:00Z" }]);
    renderPage();
    expect(await screen.findByRole("button", { name: "Verify" })).not.toBeNull();
    expect(screen.getByText(/Completed Aisha/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More row actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark unsatisfactory" }));
    await waitFor(() => expect(factoryService.verifyMestiCleaningOccurrence).toHaveBeenCalledWith("occ-floor-prep", "unsatisfactory"));
    cleanup();
    factoryService.listMestiCleaningDay.mockResolvedValue([{ ...floorOccurrence, status: "completed", completed_by: "employee-1", completed_by_name: "Current User" }]);
    renderPage();
    await waitFor(() => expect(factoryService.listMestiCleaningDay.mock.calls.length).toBeGreaterThanOrEqual(3));
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(factoryService.verifyMestiCleaningOccurrence).toHaveBeenCalledWith("occ-floor-prep", "verified"));
  });

  it("does not expose verification without the canonical review permission", async () => {
    factoryService.listMestiCleaningDay.mockResolvedValue([{ ...floorOccurrence, status: "completed", completed_by: "employee-1" }]);
    renderPage({ permissions: ["factory_mesti_cleaning.view"] });
    await screen.findByText("Preparation");
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
  });

  it("starts Setup with Cleaning Requirements and keeps role configuration out of the UI", async () => {
    renderPage({ permissions: ["factory_mesti_cleaning.view", "factory_mesti_cleaning.create", "factory_mesti_cleaning.edit", "factory_mesti_cleaning.manage"] });
    fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
    expect(await screen.findByRole("button", { name: "Create Requirement" })).not.toBeNull();
    expect(screen.queryByText("Cleaning Settings")).toBeNull();
    expect(screen.queryByLabelText("Responsible Role")).toBeNull();
    expect(screen.queryByLabelText("Verifier Role")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create Requirement" }));
    expect(await screen.findByRole("dialog", { name: "Create Cleaning Requirement" })).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Task Name"), { target: { value: "Ceiling" } });
    fireEvent.click(screen.getByLabelText("Preparation"));
    fireEvent.click(screen.getByLabelText("Dry Store"));
    fireEvent.click(screen.getByRole("button", { name: "Save Requirement" }));
    await waitFor(() => expect(factoryService.saveMestiCleaningRequirement).toHaveBeenCalledWith(expect.objectContaining({ task_name: "Ceiling", location_ids: ["loc-prep", "loc-store"] })));
    expect(factoryService.saveMestiCleaningRequirement.mock.calls[0][0]).not.toHaveProperty("responsible_role_id");
    expect(factoryService.saveMestiCleaningRequirement.mock.calls[0][0]).not.toHaveProperty("verifier_role_id");
  });

  it("sends an unchanged current requirement back with its identity so the trusted no-op version authority remains in control", async () => {
    factoryService.saveMestiCleaningRequirement.mockResolvedValue(data.mestiCleaningRequirements[0]);
    renderPage({ permissions: ["factory_mesti_cleaning.view", "factory_mesti_cleaning.edit"] });
    fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    expect(await screen.findByRole("dialog", { name: "Edit Cleaning Requirement" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Requirement" }));
    await waitFor(() => expect(factoryService.saveMestiCleaningRequirement).toHaveBeenCalledWith(expect.objectContaining({
      id: "req-floor-v5", logical_requirement_id: "logical-floor", version_no: 5,
    })));
  });

  it("shows Effective From in Setup and sends a corrected date through the canonical version authority", async () => {
    factoryService.saveMestiCleaningRequirement.mockResolvedValue({ ...data.mestiCleaningRequirements[0], effective_from: "2026-09-20" });
    renderPage({ permissions: ["factory_mesti_cleaning.view", "factory_mesti_cleaning.edit"] });
    fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
    expect(await screen.findByText("Effective From")).not.toBeNull();
    expect(screen.getAllByText("01/09/2026")).toHaveLength(2);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Select date" }));
    fireEvent.click(await screen.findByRole("button", { name: "20" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Requirement" }));
    await waitFor(() => expect(factoryService.saveMestiCleaningRequirement).toHaveBeenCalledWith(expect.objectContaining({
      id: "req-floor-v5", effective_from: "2026-09-20",
    })));
  });

  it("keeps version-pinned Task/Location rows expanded with read-only task aggregates", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Monthly" }));
    expect(await screen.findByText("Task / Location")).toBeTruthy();
    expect(screen.getAllByText("Floor")).toHaveLength(2);
    expect(screen.getByTitle("Requirement version 4")).toBeTruthy();
    expect(screen.getByTitle(/1 of 2 verified/).tagName).toBe("SPAN");
    expect(screen.getByText("Preparation")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Floor · Cooking.*Verified/ }));
    expect(await screen.findByRole("region", { name: "Cleaning occurrence actions" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View details" }));
    expect(await screen.findByRole("dialog", { name: "Floor · Cooking" })).toBeTruthy();
    expect(screen.getByText("Isaac")).toBeTruthy();
    expect(screen.queryByLabelText("Location occurrence evidence")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Collapse Floor locations" })[0]);
    expect(screen.queryByText("Preparation")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Expand Floor locations" })[0]);
    expect(screen.getByText("Preparation")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Floor.*03\/09\/2026/ })).toBeNull();
  });

  it("keeps one cell popover open across distinct Complete and Verify transactions", async () => {
    const completed = { ...floorOccurrence, status: "completed", completed_by: "employee-1" };
    const verified = { ...completed, status: "verified", verified_by_name: "Current User" };
    factoryService.listMestiCleaningMonth.mockResolvedValueOnce(monthlyRows).mockResolvedValueOnce(monthWith(completed)).mockResolvedValue(monthWith(verified));
    let complete;
    factoryService.completeMestiCleaningOccurrence.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Monthly" }));
    fireEvent.click(await screen.findByRole("button", { name: /Floor · Preparation.*Pending/ }));
    const region = screen.getByRole("region", { name: "Cleaning occurrence actions" });
    fireEvent.click(within(region).getByRole("button", { name: "Complete" }));
    fireEvent.click(within(region).getByRole("button", { name: "Saving..." }));
    expect(factoryService.completeMestiCleaningOccurrence).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    complete({});
    fireEvent.click(await within(region).findByRole("button", { name: "Verify", exact: true }));
    await waitFor(() => expect(factoryService.verifyMestiCleaningOccurrence).toHaveBeenCalledWith("occ-floor-prep", "verified"));
    await waitFor(() => expect(within(region).getByText("Verified")).toBeTruthy());
    expect(screen.getByRole("region", { name: "Cleaning occurrence actions" })).toBe(region);
    expect(within(region).queryByRole("button", { name: "Complete" })).toBeNull();
    expect(within(region).queryByRole("button", { name: "Verify" })).toBeNull();
    fireEvent.click(within(region).getByRole("button", { name: "View details" }));
    expect(await screen.findByRole("dialog", { name: "Floor · Preparation" })).toBeTruthy();
  });

  it("refreshes after a concurrent transition rejection rather than leaving a stale Complete action", async () => {
    factoryService.completeMestiCleaningOccurrence.mockRejectedValue(new Error("Cleaning occurrence cannot be completed from its current state."));
    factoryService.listMestiCleaningMonth.mockResolvedValueOnce(monthlyRows).mockResolvedValue(monthWith({ ...floorOccurrence, status: "completed" }));
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Monthly" }));
    fireEvent.click(await screen.findByRole("button", { name: /Floor · Preparation.*Pending/ }));
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    expect((await screen.findByRole("alert")).textContent).toContain("current state");
    expect(await screen.findByRole("button", { name: "Verify", exact: true })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Complete" })).toBeNull();
  });

  it("blocks stale actions if refresh fails and recovers through a read-only retry", async () => {
    factoryService.listMestiCleaningMonth.mockResolvedValueOnce(monthlyRows).mockRejectedValueOnce(new Error("Refresh unavailable")).mockResolvedValue(monthWith({ ...floorOccurrence, status: "completed" }));
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Monthly" }));
    fireEvent.click(await screen.findByRole("button", { name: /Floor · Preparation.*Pending/ }));
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry refresh" }));
    expect(await screen.findByRole("button", { name: "Verify", exact: true })).toBeTruthy();
    expect(factoryService.completeMestiCleaningOccurrence).toHaveBeenCalledTimes(1);
  });

  it("returns a pending mutation refresh to the current Daily owner after leaving Monthly", async () => {
    let complete;
    factoryService.completeMestiCleaningOccurrence.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Monthly" }));
    fireEvent.click(await screen.findByRole("button", { name: /Floor · Preparation.*Pending/ }));
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    fireEvent.click(screen.getByRole("tab", { name: "Daily", exact: true }));
    complete({});
    await waitFor(() => expect(factoryService.listMestiCleaningDay.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(factoryService.listMestiCleaningMonth).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "Cleaning occurrence actions" })).toBeNull();
  });

  it("keeps an invalid selected backdate visible with actionable server validation", async () => {
    const message = "Effective From must be on or after 03/09/2026 to preserve existing versions and issued occurrences. The selected date was not saved.";
    factoryService.saveMestiCleaningRequirement.mockRejectedValue(new Error(message));
    renderPage({ permissions: ["factory_mesti_cleaning.edit"] });
    fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Select date" }));
    fireEvent.click(screen.getByRole("button", { name: "Prev", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "20", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Save Requirement" }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("20/08/2026")).toBeTruthy();
    expect(factoryService.saveMestiCleaningRequirement).toHaveBeenCalledWith(expect.objectContaining({ effective_from: "2026-08-20" }));
  });

  it("keeps Monthly details readable without exposing unauthorized mutations", async () => {
    renderPage({ permissions: ["factory_mesti_cleaning.view"] });
    fireEvent.click(screen.getByRole("tab", { name: "Monthly" }));
    fireEvent.click(await screen.findByRole("button", { name: /Floor · Preparation.*Pending/ }));
    expect(screen.getByRole("region", { name: "Cleaning occurrence actions" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Complete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
  });

  it("uses segmented frequency, non-search Status and reversible bulk Location selection", async () => {
    renderPage({ permissions: ["factory_mesti_cleaning.manage"] });
    fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
    expect(screen.getByText("Preparation, Cooking, Dry Store")).toBeTruthy();
    expect(screen.queryByText("Version 5")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create Requirement" }));
    fireEvent.click(screen.getByRole("tab", { name: "Weekly" }));
    expect(screen.getByRole("checkbox", { name: "Mon" }).checked).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Wed" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("tab", { name: "Daily" }));
    expect(screen.queryByRole("checkbox", { name: "Wed" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Weekly" }));
    expect(screen.getByRole("checkbox", { name: "Wed" }).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Select All" }));
    expect(screen.getByRole("checkbox", { name: "Cooking" }).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("checkbox", { name: "Cooking" }).checked).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Preparation" }));
    fireEvent.click(screen.getByRole("button", { name: "Status", exact: true }));
    expect(screen.queryByRole("textbox", { name: /Search Status/ })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "Inactive" }));
    fireEvent.change(screen.getByLabelText("Task Name"), { target: { value: "Ceiling" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Requirement" }));
    await waitFor(() => expect(factoryService.saveMestiCleaningRequirement).toHaveBeenCalledWith(expect.objectContaining({ status: "inactive", recurrence_type: "weekly", recurrence_weekdays: [1, 3], location_ids: ["loc-prep"] })));
  });
});
