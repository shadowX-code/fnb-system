import { afterEach, expect, it, vi } from "vitest";
import {
  layoutLabelText,
  labelText,
  renderLabel,
  mmToDots,
} from "../labelRenderer.js";
import {
  productLabelDraft,
  labelPreviewSnapshot,
} from "../labelManagementModel.js";
const template = {
  id: "s08",
  definition: {
    reference_note: "Layout transcribed from supplied Labelife S08 screenshot.",
    elements: [
      { type: "text", text: "Ingredients:", x: 4, y: 4, w: 70, h: 4, size: 2 },
      {
        type: "text",
        text: "Dried Shrimp, Chili",
        x: 4,
        y: 10,
        w: 70,
        h: 10,
        size: 2,
      },
    ],
  },
};
afterEach(() => vi.restoreAllMocks());
it("binds S01 ingredients to S01 content, never S08 sample, and leaves frozen legacy content alone", () => {
  const payload = productLabelDraft({
    sku: { product_code: "S01", product_name: "Black Pepper Sauce" },
    templates: [template],
  });
  const snapshot = labelPreviewSnapshot(payload, template.definition, {
    product_code: "S01",
  });
  expect(labelText(snapshot, 1)).toBe("");
  const content = { ...payload.content, ingredients: "Black pepper, water" };
  expect(
    labelText(
      labelPreviewSnapshot({ ...payload, content }, template.definition),
      1,
    ),
  ).toBe("Black pepper, water");
  expect(labelText({ definition: template.definition }, 1)).toBe(
    "Dried Shrimp, Chili",
  );
});
it("reports long and multilingual text overflow without shrinking", () => {
  const ctx = { measureText: (text) => ({ width: [...text].length * 2 }) };
  const element = { w: 8, h: 5, size: 2 };
  expect(layoutLabelText(ctx, "123456789", element)).toMatchObject({
    lines: ["1234", "5678", "9"],
    lineHeight: 2.5,
    overflow: true,
  });
  expect(layoutLabelText(ctx, "黑胡椒酱", element).overflow).toBe(false);
  expect(layoutLabelText(ctx, "字", { ...element, w: 1 }).overflow).toBe(true);
  expect(element.size).toBe(2);
});
function canvasFixture() {
  const pixels = {
    data: new Uint8ClampedArray(mmToDots(80) * mmToDots(90) * 4).fill(255),
  };
  const ctx = {
    fillRect: vi.fn(),
    scale: vi.fn(),
    measureText: (text) => ({ width: text.length }),
    fillText: vi.fn(),
    getImageData: () => pixels,
    putImageData: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  };
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,pixels",
  );
  return ctx;
}
it("uses identical canonical print pixels for valid Studio previews and rejects overflowing print work", async () => {
  canvasFixture();
  const snapshot = {
    width_mm: 80,
    height_mm: 90,
    definition: {
      elements: [
        { type: "text", text: "Valid", x: 4, y: 4, w: 20, h: 10, size: 2 },
      ],
    },
  };
  const print = await renderLabel(snapshot),
    preview = await renderLabel(snapshot, { diagnostics: true });
  expect(preview.raster).toEqual(print.raster);
  expect(preview.preview).toEqual(print.preview);
  const overflow = {
    ...snapshot,
    definition: { elements: [{ ...snapshot.definition.elements[0], h: 1 }] },
  };
  await expect(renderLabel(overflow)).rejects.toThrow(/does not fit/);
  const invalidPreview = await renderLabel(overflow, { diagnostics: true });
  expect(invalidPreview.issues[0]).toMatchObject({
    index: 0,
    severity: "error",
  });
  expect(invalidPreview.raster).toBeNull();
  const edge = await renderLabel(
    {
      ...snapshot,
      definition: { elements: [{ ...snapshot.definition.elements[0], x: 1 }] },
    },
    { diagnostics: true },
  );
  expect(edge.issues[0].severity).toBe("warning");
});

it("keeps explicitly static text in newly authored templates static even beneath an Ingredients caption", () => {
  const definition = { elements: template.definition.elements };
  expect(
    labelText({ definition, content: { ingredients: "SKU content" } }, 1),
  ).toBe("Dried Shrimp, Chili");
});
