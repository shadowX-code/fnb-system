import { describe, it, expect } from "vitest";
import {
  productLabelDraft,
  templateLabelDraft,
  labelPreviewSnapshot,
  moveLabelElement,
  labelContentWarnings,
} from "../labelManagementModel.js";
import { legacyLabelContentField } from "../labelRenderer.js";
const definition = {
  reference_note: "Layout transcribed from supplied Labelife S08 screenshot.",
  elements: [
    { type: "text", text: "Ingredients:", x: 5, y: 5, w: 70, h: 7, size: 3 },
    {
      type: "text",
      text: "Reference ingredients",
      x: 5,
      y: 15,
      w: 70,
      h: 12,
      size: 3,
    },
    {
      type: "text",
      field: "manufacturing_date",
      x: 5,
      y: 30,
      w: 70,
      h: 7,
      size: 3,
    },
  ],
};
describe("Label Management content and layout separation", () => {
  it("initializes SKU content from canonical names without inheriting template-origin ingredients", () => {
    const data = {
      sku: { product_name: "Sambal", product_code: "S9" },
      templates: [{ id: "t", definition }],
      published: null,
    };
    const draft = productLabelDraft(data);
    expect(draft.content.product_name).toBe("Sambal");
    expect(draft.content.ingredients).toBe("");
    expect(labelContentWarnings(draft, definition)).toContain(
      "Ingredients is empty for this SKU. Template sample content is not used.",
    );
    expect(data.sku).not.toHaveProperty("ingredients");
    expect(definition.elements[1]).not.toHaveProperty("field");
  });
  it("binds legacy reference fields in the working template without rewriting the published definition", () => {
    const draft = templateLabelDraft({
      published: { definition },
      draft: null,
    });
    expect(draft.definition.elements[1].field).toBe("ingredients");
    expect(draft.definition.elements[1]).not.toHaveProperty("text");
    expect(definition.elements[1].text).toBe("Reference ingredients");
    expect(legacyLabelContentField(definition, 2)).toBeNull();
  });
  it("keeps Production values read-only in product and template previews", () => {
    const snapshot = labelPreviewSnapshot(
      {
        width_mm: 80,
        height_mm: 90,
        content: {
          product_name: "Label-only name",
          manufacturing_date: "invented",
          packaged_units: 400,
        },
      },
      definition,
      null,
    );
    expect(snapshot.product_name).toBe("Label-only name");
    expect(snapshot.manufacturing_date).toBe("DD/MM/YYYY");
    expect(snapshot.packaged_units).toBe("PACKS");
  });
  it("clamps movement and resize to the physical media bounds", () => {
    const e = { x: 5, y: 5, w: 20, h: 10 };
    expect(moveLabelElement(e, 500, -500, 80, 90)).toMatchObject({
      x: 60,
      y: 0,
    });
    expect(moveLabelElement(e, 500, -500, 80, 90, true)).toMatchObject({
      w: 75,
      h: 0.5,
    });
    expect(e).toEqual({ x: 5, y: 5, w: 20, h: 10 });
  });
});

it("retains existing approved SKU content and saved draft evidence for review", () => {
  const content = {
    product_name: "Black Pepper",
    ingredients: "User-approved ingredients",
  };
  const approved = { version: 2, template_id: "t", content };
  const data = {
    sku: { product_code: "S01" },
    templates: [{ id: "t", definition }],
    published: approved,
  };
  expect(productLabelDraft(data).content.ingredients).toBe(
    "User-approved ingredients",
  );
  const payload = { content: { ingredients: "Saved reference ingredients" } };
  expect(
    productLabelDraft({ ...data, draft: { state: "draft", payload } }),
  ).toBe(payload);
  expect(approved.content).toBe(content);
});
