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
    saveMestiCleaningArea: vi.fn(),
    saveMestiCleaningRequirement: vi.fn(),
    completeMestiCleaningOccurrence: vi.fn(),
    verifyMestiCleaningOccurrence: vi.fn(),
  },
}));

const roleOperator = { id: "role-operator", name: "operator", is_active: true };
const roleSupervisor = { id: "role-supervisor", name: "supervisor", is_active: true };
const area = { id: "area-1", area_name: "Preparation", location_id: "loc-1", location_name: "Preparation Area", status: "active", sort_order: 10 };
const occurrence = {
  id: "occ-1",
  due_date: "2026-09-02",
  status: "pending",
  requirement_id: "req-1",
  area_id: "area-1",
  task_name: "Floor",
  area_name: "Preparation",
  recurrence_type: "weekly",
  recurrence_weekdays: [3],
  responsible_role_id: "role-operator",
  verifier_role_id: "role-supervisor",
};
const data = {
  storageLocations: [
    { id: "loc-1", location_name: "Preparation Area", status: "active", is_storage_location: false },
    { id: "loc-2", location_name: "Dry Store", status: "active", is_storage_location: true },
  ],
  mestiCleaningAreas: [area],
  mestiCleaningRequirements: [{ id: "req-1", task_name: "Floor", area_ids: ["area-1"], area_names: ["Preparation"], recurrence_type: "weekly", recurrence_weekdays: [3], responsible_role_id: "role-operator", verifier_role_id: "role-supervisor", status: "active", effective_from: "2026-09-01", version_no: 1 }],
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
  factoryService.listMestiCleaningDay.mockResolvedValue([occurrence]);
  factoryService.listMestiCleaningMonth.mockResolvedValue([occurrence, { ...occurrence, id: "occ-2", due_date: "2026-09-09", status: "verified" }]);
  factoryService.completeMestiCleaningOccurrence.mockResolvedValue({});
  factoryService.verifyMestiCleaningOccurrence.mockResolvedValue({});
  factoryService.saveMestiCleaningArea.mockImplementation(async (value) => ({ id: "area-new", ...value, location_name: "Preparation Area" }));
  factoryService.saveMestiCleaningRequirement.mockImplementation(async (value) => ({ id: "req-new", ...value, area_names: ["Preparation"], version_no: 1 }));
});

afterEach(cleanup);

describe("Factory MeSTI Cleaning of Area", () => {
  it("loads due daily occurrences and lets the responsible role complete pending work", async () => {
    renderPage();
    expect(await screen.findByText("Floor")).not.toBeNull();
    expect(screen.getByText("Weekly · Wed")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /complete/i }));
    await waitFor(() => expect(factoryService.completeMestiCleaningOccurrence).toHaveBeenCalledWith("occ-1"));
  });

  it("lets verifier role verify or mark completed work unsatisfactory while hiding self completion actions", async () => {
    factoryService.listMestiCleaningDay.mockResolvedValue([{ ...occurrence, status: "completed", completed_by: "employee-2", completed_by_name: "Aisha", completed_at: "2026-09-02T02:00:00Z" }]);
    renderPage({ roleId: "role-supervisor" });
    expect(await screen.findByRole("button", { name: "Verify" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unsatisfactory" }));
    await waitFor(() => expect(factoryService.verifyMestiCleaningOccurrence).toHaveBeenCalledWith("occ-1", "unsatisfactory"));
  });

  it("blocks self-verification in the UI and relies on the RPC for final enforcement", async () => {
    factoryService.listMestiCleaningDay.mockResolvedValue([{ ...occurrence, status: "completed", completed_by: "employee-1", completed_by_name: "Current User", completed_at: "2026-09-02T02:00:00Z" }]);
    renderPage({ roleId: "role-supervisor" });
    await screen.findByText("Current User");
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
  });

  it("projects the monthly matrix from preserved occurrences", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "monthly" }));
    expect(await screen.findByText("Monthly Compliance Matrix")).not.toBeNull();
    await waitFor(() => expect(factoryService.listMestiCleaningMonth).toHaveBeenCalled());
    expect(screen.getByTitle("Pending")).not.toBeNull();
    expect(screen.getByTitle("Verified")).not.toBeNull();
  });

  it("saves setup areas against any active Location, including non-storage Locations", async () => {
    renderPage({ permissions: ["factory_mesti_cleaning.view", "factory_mesti_cleaning.create", "factory_mesti_cleaning.edit", "factory_mesti_cleaning.manage"] });
    fireEvent.click(screen.getByRole("button", { name: "setup" }));
    fireEvent.change(screen.getByLabelText("Area Name"), { target: { value: "Toilet" } });
    fireEvent.click(screen.getByRole("button", { name: "Location" }));
    fireEvent.click(screen.getAllByText("Preparation Area").at(-1));
    fireEvent.click(screen.getByRole("button", { name: "Save Area" }));
    await waitFor(() => expect(factoryService.saveMestiCleaningArea).toHaveBeenCalledWith(expect.objectContaining({ area_name: "Toilet", location_id: "loc-1" })));
  });
});
