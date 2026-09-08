import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FactoryProductionIntelligenceRanking, { productionCompletion, rankProductionRows } from "../FactoryProductionIntelligenceRanking.jsx";

const rows = [
  { id: "completed", product: "Completed Sauce", packaging_sku: "S01 · 1kg Pack", uom: "kg", output_qty: 30, target_qty: 28, batch_count: 3, average_batch_qty: 10, eligible_due_count: 2, completed_within_month_count: 2, completion_rate: 100 },
  { id: "zero", product: "Scheduled Sauce", packaging_sku: "S02 · 1kg Pack", uom: "kg", output_qty: 8, batch_count: 1, average_batch_qty: 8, eligible_due_count: 1, completed_within_month_count: 0, completion_rate: 0 },
  { id: "unplanned", product: "Unplanned Sauce", packaging_sku: "S03 · 1kg Pack", uom: "kg", output_qty: 5, batch_count: 1, average_batch_qty: 5, eligible_due_count: 0, completed_within_month_count: 0, completion_rate: 0 },
];

describe("FactoryProductionIntelligenceRanking", () => {
  it("keeps completed output and due-job completion semantics distinct", () => {
    expect(productionCompletion(rows[1])).toMatchObject({ value: 0, label: "0.0%" });
    expect(productionCompletion(rows[2])).toMatchObject({ value: null, label: "—", helper: "No due Job Orders" });
    expect(rankProductionRows(rows, "completion").map((row) => row.id)).toEqual(["completed", "zero", "unplanned"]);
  });

  it("renders one ranking surface with all metric modes and canonical footer totals", () => {
    const onMetricChange = vi.fn();
    render(<FactoryProductionIntelligenceRanking rows={rows} metric="output" onMetricChange={onMetricChange} />);

    expect(screen.getByText("Production Summary")).not.toBeNull();
    expect(screen.getByText("Total Output")).not.toBeNull();
    expect(screen.getByLabelText("Target 28 kg")).not.toBeNull();
    expect(screen.getAllByText("No due Job Orders").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Completion" }));
    expect(onMetricChange).toHaveBeenCalledWith("completion");
    fireEvent.click(screen.getByRole("button", { name: "Batch Count" }));
    expect(onMetricChange).toHaveBeenCalledWith("batches");
  });
});
