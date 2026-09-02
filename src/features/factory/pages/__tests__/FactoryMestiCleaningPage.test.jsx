import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
import FactoryMestiCleaningPage from "../FactoryMestiCleaningPage.jsx";
import { factoryService } from "../../../../services/factoryService.js";

vi.mock("../../../../services/factoryService.js", () => ({ factoryService: {
  listMestiCleaningDay: vi.fn(), listMestiCleaningMonth: vi.fn(), saveMestiCleaningRequirement: vi.fn(), saveMestiCleaningSettings: vi.fn(), completeMestiCleaningOccurrence: vi.fn(), verifyMestiCleaningOccurrence: vi.fn(),
} }));

const roleOperator = { id: "role-operator", name: "operator", is_active: true };
const roleSupervisor = { id: "role-supervisor", name: "supervisor", is_active: true };
const locationPreparation = { id: "loc-prep", location_name: "Preparation", status: "active", is_storage_location: false };
const locationCooking = { id: "loc-cook", location_name: "Cooking", status: "active", is_storage_location: false };
const locationDryStore = { id: "loc-store", location_name: "Dry Store", status: "active", is_storage_location: true };
const floorOccurrence = { id: "occ-floor-prep", due_date: "2026-09-02", status: "pending", requirement_id: "req-floor-v4", logical_requirement_id: "logical-floor", location_id: "loc-prep", location_name: "Preparation", task_name: "Floor", recurrence_type: "weekly", recurrence_weekdays: [3], responsible_role_id: "role-operator", verifier_role_id: "role-supervisor" };
const floorCooking = { ...floorOccurrence, id: "occ-floor-cook", location_id: "loc-cook", location_name: "Cooking", status: "verified", verified_by_name: "Isaac", verified_at: "2026-09-02T03:00:00Z" };
const drainOccurrence = { ...floorOccurrence, id: "occ-drain-cook", requirement_id: "req-drain", logical_requirement_id: "logical-drain", location_id: "loc-cook", location_name: "Cooking", task_name: "Drain", recurrence_type: "daily", recurrence_weekdays: [] };
const monthlyRows = [
  { logical_requirement_id: "logical-floor", task_name: "Floor", recurrence_type: "weekly", recurrence_weekdays: [3], days: [{ due_date: "2026-09-02", status: "mixed", total_count: 2, verified_count: 1, completed_count: 0, unsatisfactory_count: 0, missed_count: 0, pending_count: 1, occurrences: [floorCooking, floorOccurrence] }] },
  { logical_requirement_id: "logical-floor-other", task_name: "Floor", recurrence_type: "daily", recurrence_weekdays: [], days: [{ due_date: "2026-09-02", status: "unsatisfactory", total_count: 1, verified_count: 0, completed_count: 0, unsatisfactory_count: 1, missed_count: 0, pending_count: 0, occurrences: [{ ...drainOccurrence, id: "occ-floor-other", task_name: "Floor", logical_requirement_id: "logical-floor-other", status: "unsatisfactory" }] }] },
  { logical_requirement_id: "logical-drain", task_name: "Drain", recurrence_type: "daily", recurrence_weekdays: [], days: [{ due_date: "2026-09-02", status: "completed", total_count: 1, verified_count: 0, completed_count: 1, unsatisfactory_count: 0, missed_count: 0, pending_count: 0, occurrences: [drainOccurrence] }] },
];
const data = {
  storageLocations: [locationPreparation, locationCooking, locationDryStore],
  mestiCleaningSettings: { responsible_role_id: "role-operator", verifier_role_id: "role-supervisor" },
  mestiCleaningRequirements: [
    { id: "req-floor-v5", logical_requirement_id: "logical-floor", task_name: "Floor", location_ids: ["loc-prep", "loc-cook", "loc-store"], location_names: ["Preparation", "Cooking", "Dry Store"], recurrence_type: "weekly", recurrence_weekdays: [3], status: "active", effective_from: "2026-09-01", version_no: 5 },
    { id: "req-wall", logical_requirement_id: "logical-wall", task_name: "Wall", location_ids: ["loc-cook"], location_names: ["Cooking"], recurrence_type: "weekly", recurrence_weekdays: [3], status: "active", effective_from: "2026-09-01", version_no: 1 },
  ], factoryRoles: [roleOperator, roleSupervisor],
};

function renderPage({ roleId = "role-operator", permissions = ["factory_mesti_cleaning.view", "factory_mesti_cleaning.complete", "factory_mesti_cleaning.review"] } = {}) {
  const can = (permission) => permissions.includes(permission);
  return render(<FactoryPermissionsProvider permissionSet={permissions} can={can}><FactoryMasterDataProvider data={data}><FactoryMestiCleaningPage auth={{ profile: { id: "employee-1", role_id: roleId } }} onNotify={vi.fn()} /></FactoryMasterDataProvider></FactoryPermissionsProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  factoryService.listMestiCleaningDay.mockResolvedValue([floorOccurrence, drainOccurrence]);
  factoryService.listMestiCleaningMonth.mockResolvedValue(monthlyRows);
  factoryService.completeMestiCleaningOccurrence.mockResolvedValue({});
  factoryService.verifyMestiCleaningOccurrence.mockResolvedValue({});
  factoryService.saveMestiCleaningSettings.mockImplementation(async (value) => value);
  factoryService.saveMestiCleaningRequirement.mockImplementation(async (value) => ({ id: "req-new", logical_requirement_id: "logical-new", ...value, location_names: ["Preparation", "Dry Store"], version_no: 1 }));
});

afterEach(cleanup);

describe("Factory MeSTI Cleaning of Area", () => {
  it("keeps Daily Location-centric and lets the snapshotted responsible role complete work", async () => {
    renderPage();
    expect(await screen.findByText("Preparation")).not.toBeNull();
    expect(screen.getByText("Cooking")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /complete/i })[0]);
    await waitFor(() => expect(factoryService.completeMestiCleaningOccurrence).toHaveBeenCalledWith("occ-floor-prep"));
  });

  it("lets the snapshotted verifier role review work and hides self-verification", async () => {
    factoryService.listMestiCleaningDay.mockResolvedValue([{ ...floorOccurrence, status: "completed", completed_by: "employee-2", completed_by_name: "Aisha", completed_at: "2026-09-02T02:00:00Z" }]);
    renderPage({ roleId: "role-supervisor" });
    expect(await screen.findByRole("button", { name: "Verify" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unsatisfactory" }));
    await waitFor(() => expect(factoryService.verifyMestiCleaningOccurrence).toHaveBeenCalledWith("occ-floor-prep", "unsatisfactory"));
    cleanup();
    factoryService.listMestiCleaningDay.mockResolvedValue([{ ...floorOccurrence, status: "completed", completed_by: "employee-1", completed_by_name: "Current User" }]);
    renderPage({ roleId: "role-supervisor" });
    await waitFor(() => expect(factoryService.listMestiCleaningDay.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
  });

  it("uses module-level roles in Cleaning Settings and keeps them out of requirement save payloads", async () => {
    renderPage({ permissions: ["factory_mesti_cleaning.view", "factory_mesti_cleaning.create", "factory_mesti_cleaning.edit", "factory_mesti_cleaning.manage"] });
    fireEvent.click(screen.getByRole("button", { name: "setup" }));
    expect(await screen.findByText("Cleaning Settings")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
    await waitFor(() => expect(factoryService.saveMestiCleaningSettings).toHaveBeenCalledWith({ responsible_role_id: "role-operator", verifier_role_id: "role-supervisor" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Requirement" }));
    expect(screen.getAllByLabelText("Responsible Role")).toHaveLength(1);
    expect(screen.getAllByLabelText("Verifier Role")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Task Name"), { target: { value: "Ceiling" } });
    fireEvent.click(screen.getByLabelText("Preparation"));
    fireEvent.click(screen.getByLabelText("Dry Store"));
    fireEvent.click(screen.getByRole("button", { name: "Save Requirement" }));
    await waitFor(() => expect(factoryService.saveMestiCleaningRequirement).toHaveBeenCalledWith(expect.objectContaining({ task_name: "Ceiling", location_ids: ["loc-prep", "loc-store"] })));
    expect(factoryService.saveMestiCleaningRequirement.mock.calls[0][0]).not.toHaveProperty("responsible_role_id");
    expect(factoryService.saveMestiCleaningRequirement.mock.calls[0][0]).not.toHaveProperty("verifier_role_id");
  });

  it("renders one Monthly row per logical requirement, preserves distinct same-name requirements, and drills into Location evidence", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "monthly" }));
    expect(await screen.findByText("Monthly Compliance Matrix")).not.toBeNull();
    await waitFor(() => expect(factoryService.listMestiCleaningMonth).toHaveBeenCalled());
    expect(screen.getByText("Task")).not.toBeNull();
    expect(screen.queryByText("Task / Location")).toBeNull();
    expect(screen.getAllByText("Floor")).toHaveLength(2);
    expect(screen.getByTitle("1 of 2 verified")).not.toBeNull();
    expect(screen.getByTitle("Unsatisfactory")).not.toBeNull();
    expect(screen.getByTitle("Awaiting Verification")).not.toBeNull();
    fireEvent.click(screen.getByTitle("1 of 2 verified"));
    expect(await screen.findByText("Location-level occurrence evidence")).not.toBeNull();
    expect(screen.getByText("Preparation")).not.toBeNull();
    expect(screen.getByText("Cooking")).not.toBeNull();
    expect(screen.getByText("Isaac")).not.toBeNull();
  });
});
