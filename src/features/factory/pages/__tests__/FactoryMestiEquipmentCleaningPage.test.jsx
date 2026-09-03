import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
import FactoryMestiEquipmentCleaningPage from "../FactoryMestiEquipmentCleaningPage.jsx";
import { factoryService } from "../../../../services/factoryService.js";

vi.mock("../../../../services/factoryService.js", () => ({ factoryService: {
  listMestiEquipmentCleaningDay: vi.fn(), listMestiEquipmentCleaningMonth: vi.fn(), saveMestiEquipmentCleaningRequirement: vi.fn(), completeMestiEquipmentCleaningOccurrence: vi.fn(), verifyMestiEquipmentCleaningOccurrence: vi.fn(),
} }));

const equipment = { id: "equipment-1", equipment_code: "MX-01", name: "Mixer 01", status: "active", location: { location_name: "Cooking Room" } };
const occurrence = { id: "occ-1", due_date: "2026-09-03", status: "pending", task_name: "General Cleaning", equipment_id: "equipment-1", equipment_code: "MX-01", equipment_name: "Mixer 01", location_name: "Cooking Room", source_type: "scheduled", recurrence_type: "daily" };
const afterOperation = { ...occurrence, id: "occ-production", task_name: "After Production Cleaning", source_type: "after_production", production_id: "production-1", production_snapshot: { product_name: "Chicken Curry Paste", batch_no: "B260903-018", completed_at: "2026-09-03T08:00:00Z" } };
const data = { equipment: [equipment], mestiEquipmentCleaningRequirements: [{ id: "req-1", logical_requirement_id: "logical-1", task_name: "General Cleaning", equipment_ids: ["equipment-1"], equipment_names: ["MX-01 · Mixer 01"], recurrence_type: "daily", recurrence_weekdays: [], status: "active", effective_from: "2026-09-03", version_no: 1 }] };

function renderPage({ permissions = ["factory_mesti_equipment_cleaning.view", "factory_mesti_equipment_cleaning.complete", "factory_mesti_equipment_cleaning.review", "factory_mesti_equipment_cleaning.manage"] } = {}) {
  const can = (permission) => permissions.includes(permission);
  return render(<FactoryPermissionsProvider permissionSet={permissions} can={can}><FactoryMasterDataProvider data={data}><FactoryMestiEquipmentCleaningPage auth={{ profile: { id: "employee-1" } }} onNotify={vi.fn()} /></FactoryMasterDataProvider></FactoryPermissionsProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  factoryService.listMestiEquipmentCleaningDay.mockResolvedValue([occurrence, afterOperation]);
  factoryService.listMestiEquipmentCleaningMonth.mockResolvedValue([{ logical_requirement_id: "logical-1", task_name: "General Cleaning", source_type: "scheduled", recurrence_type: "daily", days: [{ due_date: "2026-09-03", status: "verified", total_count: 1, verified_count: 1, occurrences: [occurrence] }] }]);
  factoryService.saveMestiEquipmentCleaningRequirement.mockImplementation(async (value) => ({ id: value.id || "req-2", logical_requirement_id: value.logical_requirement_id || "logical-2", ...value }));
  factoryService.completeMestiEquipmentCleaningOccurrence.mockResolvedValue({});
  factoryService.verifyMestiEquipmentCleaningOccurrence.mockResolvedValue({});
});
afterEach(cleanup);

describe("FactoryMestiEquipmentCleaningPage", () => {
  it("groups Daily occurrences by canonical Equipment and presents after-production provenance", async () => {
    renderPage();
    expect(await screen.findByText("MX-01 · Mixer 01")).not.toBeNull();
    expect(screen.getByText(/Chicken Curry Paste/)).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Complete" })[0]);
    await waitFor(() => expect(factoryService.completeMestiEquipmentCleaningOccurrence).toHaveBeenCalledWith("occ-1"));
  });

  it("uses canonical review permission and suppresses self-verification", async () => {
    factoryService.listMestiEquipmentCleaningDay.mockResolvedValue([{ ...occurrence, status: "completed", completed_by: "employee-2" }]);
    renderPage();
    expect(await screen.findByRole("button", { name: "Verify" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unsatisfactory" }));
    await waitFor(() => expect(factoryService.verifyMestiEquipmentCleaningOccurrence).toHaveBeenCalledWith("occ-1", "unsatisfactory"));
    cleanup();
    factoryService.listMestiEquipmentCleaningDay.mockResolvedValue([{ ...occurrence, status: "completed", completed_by: "employee-1" }]);
    renderPage();
    await waitFor(() => expect(factoryService.listMestiEquipmentCleaningDay).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
  });

  it("keeps after-production source, due date, and production provenance in the Monthly drill-down", async () => {
    factoryService.listMestiEquipmentCleaningMonth.mockResolvedValue([{
      logical_requirement_id: "logical-usage",
      task_name: "Clean After Operation",
      source_type: "after_production",
      recurrence_type: "",
      days: [{ due_date: "2026-09-03", status: "completed", total_count: 1, verified_count: 0, occurrences: [afterOperation] }],
    }]);
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "monthly" }));
    fireEvent.click(await screen.findByRole("button", { name: "0/1" }));
    expect((await screen.findAllByText("After Production")).length).toBeGreaterThan(1);
    expect(screen.getByText("2026-09-03")).not.toBeNull();
    expect(screen.getByText(/Chicken Curry Paste/)).not.toBeNull();
  });

  it("keeps setup focused on Cleaning Requirements and sends ordered canonical Equipment IDs", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "setup" }));
    expect(await screen.findByText("Cleaning Requirements")).not.toBeNull();
    expect(screen.queryByText("Responsible Role")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /create requirement/i }));
    fireEvent.change(screen.getByLabelText("Task Name"), { target: { value: "Deep Cleaning" } });
    fireEvent.click(screen.getByLabelText("MX-01 Mixer 01"));
    fireEvent.click(screen.getByRole("button", { name: "Save Requirement" }));
    await waitFor(() => expect(factoryService.saveMestiEquipmentCleaningRequirement).toHaveBeenCalledWith(expect.objectContaining({ task_name: "Deep Cleaning", equipment_ids: ["equipment-1"] })));
  });
});
