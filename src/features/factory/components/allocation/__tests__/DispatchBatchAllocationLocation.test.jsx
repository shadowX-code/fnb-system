import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DispatchBatchAllocationModal from "../DispatchBatchAllocationModal.jsx";

afterEach(cleanup);

function mount(locationValid, locationType = "Room Temperature") {
  const batch = { batch_id: "batch-1", batch_no: "PB260924-03", available_qty: 70,
    location_valid: locationValid, storage_location: "Finish Good-Dry", storage_location_type: locationType };
  const onApply = vi.fn();
  render(<DispatchBatchAllocationModal item={{ quantity: 10, allocations: [{ ...batch, quantity: 10 }] }}
    sku={{ product_name: "Nasi Lemak Rice Seasoning", product_code: "S16", packaging_type: "Pack" }}
    batches={locationValid ? [batch] : []} loading={false} onClose={vi.fn()} onApply={onApply} />);
  return { batch, onApply };
}

describe("Dispatch saved allocation Location eligibility", () => {
  it.each(["Room Temperature", "Chiller", "Freezer"])("applies a saved allocation from eligible %s storage without reallocating", (type) => {
    const { batch, onApply } = mount(true, type);
    const apply = screen.getByRole("button", { name: "Apply Allocation" });
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledExactlyOnceWith([{ ...batch, quantity: 10 }]);
  });

  it("keeps unavailable saved allocations blocked", () => {
    const { onApply } = mount(false);
    const apply = screen.getByRole("button", { name: "Apply Allocation" });
    expect(apply.disabled).toBe(true);
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText("This batch is not available from an active Finished Goods location.")).toBeTruthy();
  });
});
