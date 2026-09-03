import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FactoryMestiFinishedProductStorageControlPage from "../FactoryMestiFinishedProductStorageControlPage.jsx";
import { factoryService } from "../../../../services/factoryService.js";

vi.mock("../../../../services/factoryService.js", () => ({ factoryService: {
  listMestiFinishedProductStorageControl: vi.fn(),
  listMestiFinishedProductStorageControlFilterOptions: vi.fn(),
} }));

const qaBatch = {
  id: "balance-qa-1", production_id: "production-qa-1", job_order_id: "job-qa-1", job_order_no: "JO260903-01", production_no: "PRD-20260903-VQX5",
  completed_at: "2026-09-03T09:52:00Z", completion_date: "2026-09-03", finished_good_id: "family-qa", finished_good_name: "QA After Operation Sauce",
  packaging_sku_id: "sku-qa", packaging_sku_code: "QA-AO-01", packaging_sku_name: "QA After Operation Sauce - 1kg Pack",
  completed_qty: 1, completed_uom: "Pack", storage_location_id: "storage-a", storage_location_name: "Dry Store-A", batch_no: "PB260903-02",
  manufacturing_date: "2026-09-03", expiry_date: "2027-03-03", completed_by: "employee-isaac", completed_by_name: "Isaac",
};
const secondBatch = { ...qaBatch, id: "balance-qa-2", production_id: "production-qa-2", production_no: "PRD-20260903-9SF3", batch_no: "PB260903-03", storage_location_id: "storage-b", storage_location_name: "Finished Goods-A", completed_qty: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  factoryService.listMestiFinishedProductStorageControl.mockResolvedValue({ rows: [qaBatch, secondBatch], totalCount: 2, page: 1, pageSize: 20 });
  factoryService.listMestiFinishedProductStorageControlFilterOptions.mockResolvedValue({
    finished_goods: [{ id: "family-qa", name: "QA After Operation Sauce" }],
    packaging_skus: [{ id: "sku-qa", code: "QA-AO-01", name: "QA After Operation Sauce - 1kg Pack" }],
    storage_locations: [{ id: "storage-a", name: "Dry Store-A" }, { id: "storage-b", name: "Finished Goods-A" }],
  });
});
afterEach(cleanup);

describe("FactoryMestiFinishedProductStorageControlPage", () => {
  it("renders one read-only row per completed Production batch with canonical Finished Goods storage evidence", async () => {
    render(<FactoryMestiFinishedProductStorageControlPage onNotify={vi.fn()} />);
    expect(await screen.findAllByText("QA After Operation Sauce")).toHaveLength(2);
    expect(screen.getAllByText("QA-AO-01")).toHaveLength(2);
    expect(screen.getAllByText("PB260903-02")).toHaveLength(1);
    expect(screen.getAllByText("Dry Store-A")).toHaveLength(1);
    expect(screen.getAllByText("1 Pack")).toHaveLength(1);
    expect(screen.getAllByText("PB260903-03")).toHaveLength(1);
    expect(screen.getAllByText("Finished Goods-A")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /create|edit|delete/i })).toBeNull();
  });

  it("passes Finished Good, Packaging SKU, Storage, date and search filters to the canonical read model", async () => {
    render(<FactoryMestiFinishedProductStorageControlPage onNotify={vi.fn()} />);
    await screen.findAllByText("QA After Operation Sauce");
    fireEvent.change(screen.getByPlaceholderText("Batch, production, product"), { target: { value: "PB260903-02" } });
    await waitFor(() => expect(factoryService.listMestiFinishedProductStorageControl).toHaveBeenLastCalledWith(expect.objectContaining({ filters: expect.objectContaining({ search: "PB260903-02" }) })));
    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
    await waitFor(() => expect(factoryService.listMestiFinishedProductStorageControl).toHaveBeenLastCalledWith(expect.objectContaining({ filters: expect.objectContaining({ search: "" }) })));
  });

  it("opens read-only provenance detail without inventing a write path", async () => {
    render(<FactoryMestiFinishedProductStorageControlPage onNotify={vi.fn()} />);
    await screen.findAllByText("QA After Operation Sauce");
    fireEvent.click(screen.getAllByText("PB260903-02")[0]);
    expect(await screen.findByRole("dialog", { name: "Finished Product Storage Record" })).not.toBeNull();
    expect(screen.getByText("JO260903-01")).not.toBeNull();
    expect(screen.getByText("PRD-20260903-VQX5")).not.toBeNull();
    expect(screen.getAllByText("2027-03-03")).toHaveLength(3);
    expect(screen.getAllByText("Isaac")).toHaveLength(3);
  });
});
