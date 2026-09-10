import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FactorySupplierLinkedMaterialsModal from "../FactorySupplierLinkedMaterialsModal.jsx";

afterEach(cleanup);

describe("FactorySupplierLinkedMaterialsModal", () => {
  it("loads active materials, exposes the linked count, and persists an atomic link selection", async () => {
    const supplier = { id: "supplier-1", supplier_name: "Fresh Farm", linked_material_ids: ["rm-1"] };
    const loadEligibility = vi.fn().mockResolvedValue([
      { id: "rm-1", name: "Chili", material_code: "CHI", category: "Spices", uom: "kg", is_linked: true },
      { id: "rm-2", name: "Pepper", material_code: "PEP", category: "Spices", uom: "pack", is_linked: false },
    ]);
    const onSave = vi.fn().mockResolvedValue({ linked_material_ids: ["rm-1", "rm-2"] });
    render(<FactorySupplierLinkedMaterialsModal supplier={supplier} loadEligibility={loadEligibility} onSave={onSave} onClose={vi.fn()} />);

    expect(await screen.findByText("Chili")).not.toBeNull();
    expect(screen.getByText("1 linked")).not.toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /link pepper/i }));
    expect(screen.getByText("2 linked")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(supplier, expect.arrayContaining(["rm-1", "rm-2"])));
    expect(loadEligibility).toHaveBeenCalledWith("supplier-1");
  });
});
