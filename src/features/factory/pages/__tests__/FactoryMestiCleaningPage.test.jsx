import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
import FactoryMestiCleaningPage from "../FactoryMestiCleaningPage.jsx";
import { factoryService } from "../../../../services/factoryService.js";

vi.mock("../../../../services/factoryService.js", () => ({
  factoryService: {
    listMestiCleaningDay: vi.fn(),
    listMestiCleaningMonth: vi.fn(),
    saveMestiCleaningRequirement: vi.fn(),
    completeMestiCleaningOccurrence: vi.fn(),
    verifyMestiCleaningOccurrence: vi.fn(),
  },
}));

const roleOperator = { id: "role-operator", name: "operator", is_active: true };
const roleSupervisor = { id: "role-supervisor", name: "supervisor", is_active: true };
const locationPreparation = { id: "loc-prep", location_name: "Preparation", status: "active", is_storage_location: false };
const locationCooking = { id: "loc-cook", location_name: "Cooking", status: "active", is_storage_location: false };
const locationDryStore = { id: "loc-store", location_name: "Dry Store", status: "active", is_storage_location: true };
const floorOccurrence = {
  id: "occ-floor-prep",
  due_date: "2026-09-02",
  status: "pending",
  requirement_id: "req-floor",
  location_id: "loc-prep",
  location_name: "Preparation",
  task_name: "Floor",
  recurrence_type: "weekly",
  recurrence_weekdays: [3],
  responsible_role_id: "role-operator",
  verifier_role_id: "role-supervisor",
};
const drainOccurrence = {
  ...floorOccurrence,
  id: "occ-drain-cook",
  requirement_id: "req-drain",
  location_id: "loc-cook",
  location_name: "Cooking",
  task_name: "Drain",
  recurrence_type: "daily",
  recurrence_weekdays: [],
};
const data = {
  storageLocations: [locationPreparation, locationCooking, locationDryStore],
  mestiCleaningRequirements: [
    { id: "req-floor", task_name: "Floor", location_ids: ["loc-prep", "loc-cook", "loc-store"], location_names: ["Preparation", "Cooking", "Dry Store"], recurrence_type: "weekly", recurrence_weekdays: [3], responsible_role_id: "role-operator", verifier_role_id: "role-supervisor", status: "active", effective_from: "2026-09-01", version_no: 1 },
    { id: "req-wall", task_name: "Wall", location_ids: ["loc-cook"], location_names: ["Cooking"], recurrence_type: "weekly", recurrence_weekdays: [3], responsible_role_id: "role-operator", verifier_role_id: "role-supervisor", status: "active", effective_from: "2026-09-01", version_no: 1 },
  ],
  factoryRoles: [roleOperator, roleSupervisor],
};

function renderPage({ roleId = "role-operator", permissions = ["factory_mesti_cleaning.view", "factory_mesti_cleaning.complete", "factory_mesti_cleaning.review"] } = {}) {
  const can = (permission) => permissions.includes(permission);
  return render(
    <FactoryPermissionsProvider permissionSet={permissions} can={can}>
      <FactoryMasterDataProvider data={data}>
        <FactoryMestiCleaningPage auth={{ profile: { id: "employee-1", role_id: roleId } }} onNotify={vi.fn()} />
      </FactoryMasterDataProvider>
    </FactoryPermissionsProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  factoryService.listMestiCleaningDay.mockResolvedValue([floorOccurrence, drainOccurrence]);
  factoryService.listMestiCleaningMonth.mockResolvedValue([floorOccurrence, { ...floorOccurrence, id: "occ-floor-prep-2", due_date: "2026-09-09", status: "verified" }, drainOccurrence]);
  factoryService.completeMestiCleaningOccurrence.mockResolvedValue({});
  factoryService.verifyMestiCleaningOccurrence.mockResolvedValue({});
  factoryService.saveMestiCleaningRequirement.mockImplementation(async (value) => ({ id: "req-new", ...value, location_names: ["Preparation", "Dry Store"], version_no: 1 }));
});

afterEach(cleanup);

describe("Factory MeSTI Cleaning of Area", () => {
  it("loads due daily occurrences, groups by Location, and lets the responsible role complete pending work", async () => {
    renderPage();
    expect(await screen.findByText("Preparation")).not.toBeNull();
    expect(screen.getByText("Cooking")).not.toBeNull();
    expect(screen.getByText("Floor")).not.toBeNull();
    expect(screen.getByText("Weekly · Wed")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /complete/i })[0]);
    await waitFor(() => expect(factoryService.completeMestiCleaningOccurrence).toHaveBeenCalledWith("occ-floor-prep"));
  });

  it("lets verifier role verify or mark completed work unsatisfactory while hiding self completion actions", async () => {
    factoryService.listMestiCleaningDay.mockResolvedValue([{ ...floorOccurrence, status: "completed", completed_by: "employee-2", completed_by_name: "Aisha", completed_at: "2026-09-02T02:00:00Z" }]);
    renderPage({ roleId: "role-supervisor" });
    expect(await screen.findByRole("button", { name: "Verify" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unsatisfactory" }));
    await waitFor(() => expect(factoryService.verifyMestiCleaningOccurrence).toHaveBeenCalledWith("occ-floor-prep", "unsatisfactory"));
  });

  it("blocks self-verification in the UI and relies on the RPC for final enforcement", async () => {
    factoryService.listMestiCleaningDay.mockResolvedValue([{ ...floorOccurrence, status: "completed", completed_by: "employee-1", completed_by_name: "Current User", completed_at: "2026-09-02T02:00:00Z" }]);
    renderPage({ roleId: "role-supervisor" });
    await screen.findByText("Current User");
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
  });

  it("projects the monthly matrix from preserved Location occurrences", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "monthly" }));
    expect(await screen.findByText("Monthly Compliance Matrix")).not.toBeNull();
    await waitFor(() => expect(factoryService.listMestiCleaningMonth).toHaveBeenCalled());
    expect(screen.getByText("Task / Location")).not.toBeNull();
    expect(screen.getAllByTitle("Pending").length).toBeGreaterThan(0);
    expect(screen.getByTitle("Verified")).not.toBeNull();
  });

  it("saves requirements directly against storage and non-storage Locations", async () => {
    renderPage({ permissions: ["factory_mesti_cleaning.view", "factory_mesti_cleaning.create", "factory_mesti_cleaning.edit", "factory_mesti_cleaning.manage"] });
    fireEvent.click(screen.getByRole("button", { name: "setup" }));
    expect(screen.queryByText("Areas")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create Requirement" }));
    fireEvent.change(screen.getByLabelText("Task Name"), { target: { value: "Ceiling" } });
    fireEvent.click(screen.getByLabelText("Preparation"));
    fireEvent.click(screen.getByLabelText("Dry Store"));
    fireEvent.click(screen.getByRole("button", { name: "Save Requirement" }));
    await waitFor(() => expect(factoryService.saveMestiCleaningRequirement).toHaveBeenCalledWith(expect.objectContaining({ task_name: "Ceiling", location_ids: ["loc-prep", "loc-store"] })));
  });

  it("keeps one Location available for multiple requirements and one requirement across multiple Locations", async () => {
    renderPage({ permissions: ["factory_mesti_cleaning.view", "factory_mesti_cleaning.create", "factory_mesti_cleaning.edit", "factory_mesti_cleaning.manage"] });
    fireEvent.click(screen.getByRole("button", { name: "setup" }));
    expect(await screen.findByText(/Preparation, Cooking, Dry Store/)).not.toBeNull();
    expect(screen.getByText("Cooking")).not.toBeNull();
  });
});
