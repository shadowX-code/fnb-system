import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactoryMasterDataProvider } from "../../context/FactoryMasterDataContext.jsx";
import { FactoryPermissionsProvider } from "../../context/FactoryPermissionsContext.jsx";
import FactoryMestiEquipmentCleaningPage from "../FactoryMestiEquipmentCleaningPage.jsx";
import { factoryService } from "../../../../services/factoryService.js";

vi.mock("../../../../services/factoryService.js", () => ({ factoryService: {
  listMestiEquipmentCleaningDay: vi.fn(), listMestiEquipmentCleaningMonth: vi.fn(), saveMestiEquipmentCleaningRequirement: vi.fn(), completeMestiEquipmentCleaningOccurrence: vi.fn(), verifyMestiEquipmentCleaningOccurrence: vi.fn(),
} }));

const equipment = { id: "equipment-1", equipment_code: "MX-01", name: "Mixer 01", status: "active", category: { name: "Mixing" }, location: { location_name: "Cooking Room" } };
const secondEquipment = { id: "equipment-2", equipment_code: "FL-02", name: "Filler 02", status: "active", category: { name: "Filling" }, location: { location_name: "Preparation Room" } };
const occurrence = { id: "occ-1", due_date: "2026-09-03", status: "pending", task_name: "Daily Cleaning", equipment_id: "equipment-1", equipment_code: "MX-01", equipment_name: "Mixer 01", location_name: "Cooking Room", source_type: "scheduled", recurrence_type: "daily" };
const afterProduction = { ...occurrence, id: "occ-production", task_name: "After Production Cleaning", status: "completed", source_type: "after_production", production_id: "production-1", production_snapshot: { product_name: "Chicken Curry Paste", batch_no: "B260903-018", production_no: "PRD-01", sop_version: "v1", completed_at: "2026-09-03T08:00:00Z" } };
const verifiedOccurrence = { ...occurrence, id: "occ-verified", status: "verified", equipment_id: "equipment-2", equipment_code: "FL-02", equipment_name: "Filler 02", location_name: "Preparation Room" };
const data = { equipment: [equipment, secondEquipment], mestiEquipmentCleaningRequirements: [{ id: "req-1", logical_requirement_id: "logical-1", task_name: "Daily Cleaning", equipment_ids: ["equipment-1"], equipment_names: ["MX-01 · Mixer 01"], recurrence_type: "daily", recurrence_weekdays: [], status: "active", effective_from: "2026-09-03", version_no: 1 }] };
const monthlyRows = [{ equipment_id: "equipment-1", equipment_code: "MX-01", equipment_name: "Mixer 01", location_name: "Cooking Room", summary: { total_count: 2, verified_count: 0, completed_count: 1, pending_count: 1, unsatisfactory_count: 0, missed_count: 0 }, days: [{ due_date: "2026-09-03", status: "completed", total_count: 2, verified_count: 0, completed_count: 1, pending_count: 1, unsatisfactory_count: 0, missed_count: 0, occurrences: [occurrence, afterProduction] }] }, { equipment_id: "equipment-2", equipment_code: "FL-02", equipment_name: "Filler 02", location_name: "Preparation Room", summary: { total_count: 1, verified_count: 1, completed_count: 0, pending_count: 0, unsatisfactory_count: 0, missed_count: 0 }, days: [{ due_date: "2026-09-03", status: "verified", total_count: 1, verified_count: 1, completed_count: 0, pending_count: 0, unsatisfactory_count: 0, missed_count: 0, occurrences: [verifiedOccurrence] }] }];

function renderPage({ permissions = ["factory_mesti_equipment_cleaning.view", "factory_mesti_equipment_cleaning.complete", "factory_mesti_equipment_cleaning.review", "factory_mesti_equipment_cleaning.manage"] } = {}) {
  const can = (permission) => permissions.includes(permission);
  return render(<FactoryPermissionsProvider permissionSet={permissions} can={can}><FactoryMasterDataProvider data={data}><FactoryMestiEquipmentCleaningPage auth={{ profile: { id: "employee-1" } }} onNotify={vi.fn()} /></FactoryMasterDataProvider></FactoryPermissionsProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  factoryService.listMestiEquipmentCleaningDay.mockResolvedValue([occurrence, afterProduction]);
  factoryService.listMestiEquipmentCleaningMonth.mockResolvedValue(monthlyRows);
  factoryService.saveMestiEquipmentCleaningRequirement.mockImplementation(async (value) => ({ id: value.id || "req-2", logical_requirement_id: value.logical_requirement_id || "logical-2", ...value }));
  factoryService.completeMestiEquipmentCleaningOccurrence.mockResolvedValue({});
  factoryService.verifyMestiEquipmentCleaningOccurrence.mockResolvedValue({});
});
afterEach(cleanup);

describe("FactoryMestiEquipmentCleaningPage", () => {
  it("keeps Daily Equipment-centric with a compact status summary and After Production provenance", async () => {
    renderPage();
    expect(await screen.findByText("MX-01 · Mixer 01")).not.toBeNull();
    expect(screen.getByText("2 Due")).not.toBeNull();
    expect(screen.getByText(/After Production · Chicken Curry Paste · B260903-018/)).not.toBeNull();
    expect(screen.queryByText("Details")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
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

  it("renders one Monthly row per Equipment and retains every same-day obligation in the drill-down", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "monthly" }));
    expect(await screen.findByText("MX-01 · Mixer 01")).not.toBeNull();
    expect(screen.getByText("FL-02 · Filler 02")).not.toBeNull();
    expect(screen.getAllByText("2 cleanings · 0 verified · 1 pending")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /MX-01 on .*2 obligations/i }));
    expect((await screen.findAllByText("Daily Cleaning")).length).toBeGreaterThan(0);
    expect(screen.getByText("After Production Cleaning")).not.toBeNull();
    expect(screen.getByText(/Chicken Curry Paste · B260903-018/)).not.toBeNull();
    expect(screen.getByText(/PRD-01 · SOP v1/)).not.toBeNull();
  });

  it("distinguishes verified, awaiting verification, and unsatisfactory Monthly cell states", async () => {
    factoryService.listMestiEquipmentCleaningMonth.mockResolvedValue([{ ...monthlyRows[0], days: [{ ...monthlyRows[0].days[0], status: "unsatisfactory", unsatisfactory_count: 1, occurrences: [{ ...occurrence, status: "unsatisfactory" }, afterProduction] }] }, monthlyRows[1]]);
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "monthly" }));
    expect((await screen.findByRole("button", { name: /MX-01 on .*2 obligations/i })).className).toContain("text-rose-700");
    expect(screen.getByRole("button", { name: /FL-02 on .*1 obligations/i }).className).toContain("text-emerald-700");
  });

  it("keeps Setup scoped to scheduled requirements and supports searchable Equipment selection", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "setup" }));
    expect(await screen.findByText("Scheduled Cleaning Requirements")).not.toBeNull();
    expect(screen.queryByText("Responsible Role")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /create requirement/i }));
    fireEvent.change(screen.getByLabelText("Task Name"), { target: { value: "Deep Cleaning" } });
    fireEvent.change(screen.getByPlaceholderText("Search equipment, category, or location"), { target: { value: "Filler" } });
    expect(screen.getByText("FL-02 · Filler 02")).not.toBeNull();
    fireEvent.click(screen.getByLabelText("FL-02 Filler 02"));
    expect(screen.getByText("1 equipment selected")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Create Requirement" }).at(-1));
    await waitFor(() => expect(factoryService.saveMestiEquipmentCleaningRequirement).toHaveBeenCalledWith(expect.objectContaining({ task_name: "Deep Cleaning", equipment_ids: ["equipment-2"] })));
  });
});
