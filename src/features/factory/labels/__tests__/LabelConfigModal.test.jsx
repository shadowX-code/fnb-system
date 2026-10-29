import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import LabelConfigModal from "../LabelConfigModal.jsx";
import { renderLabel } from "../labelRenderer.js";
vi.mock("../labelRenderer.js", () => ({
  validateDefinition: vi.fn(),
  renderLabel: vi
    .fn()
    .mockResolvedValue({ preview: "data:image/png;base64,test" }),
}));
vi.mock("../../../../services/factoryLabelService.js", () => ({
  factoryLabelService: {
    settings: vi
      .fn()
      .mockResolvedValue({
        config: null,
        templates: [
          { id: "s08", name: "S08", version: 1, definition: { elements: [] } },
        ],
      }),
    saveConfig: vi.fn(),
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("previews canonical family names without packaging suffixes or invented dates and requires explicit approval", async () => {
  render(
    <LabelConfigModal
      sku={{
        id: "sku",
        product_code: "S9",
        product_family_name: "Dried Shrimp Sambal",
        product_name_en: "Dried Shrimp Sambal - 1kg Pack",
        product_family_name_cn: "虾米叁巴酱",
        product_family_name_bm: "Sambal Udang Kering",
        pack_size_qty: 1,
        pack_size_uom: "kg",
      }}
      onClose={() => {}}
    />,
  );
  await screen.findByAltText("Packaging SKU label template preview");
  await waitFor(() =>
    expect(renderLabel).toHaveBeenCalledWith(
      expect.objectContaining({
        product_name: "Dried Shrimp Sambal",
        product_name_cn: "虾米叁巴酱",
        product_name_bm: "Sambal Udang Kering",
        manufacturing_date: "—",
        expiry_date: "—",
        net_weight: "1 kg",
      }),
    ),
  );
  expect(
    screen.getByRole("button", { name: "Save Approved Version" }).disabled,
  ).toBe(true);
});
