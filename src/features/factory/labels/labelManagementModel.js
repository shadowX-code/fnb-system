import { legacyLabelContentField } from "./labelRenderer.js";
export const labelContentFields = [
  ["product_name", "English name"],
  ["product_name_cn", "Chinese name"],
  ["product_name_bm", "Malay name"],
  ["ingredients", "Ingredients"],
  ["manufacturer_name", "Manufacturer name"],
  ["manufacturer_address", "Manufacturer address"],
];
export const productionLabelFields = [
  "manufacturing_date",
  "expiry_date",
  "batch_no",
  "packaged_units",
];
export const labelFieldOptions = [
  ...labelContentFields.map(([value, label]) => ({ value, label })),
  ...[
    ["product_code", "SKU code"],
    ["variant_name", "Packaging size"],
    ["net_weight", "Net weight"],
    ["storage_instructions", "Storage instructions"],
  ].map(([value, label]) => ({ value, label })),
  ...[
    ["manufacturing_date", "MFG — from Production"],
    ["expiry_date", "EXP — from Production"],
    ["batch_no", "Batch No. — from Production"],
    ["packaged_units", "Actual packaged units — from Production"],
  ].map(([value, label]) => ({ value, label })),
];
export function productLabelDraft(data) {
  const config = data.published,
    sku = data.sku || {};
  return data.draft?.state === "draft"
    ? data.draft.payload
    : {
        template_id: config?.template_id || data.templates[0]?.id || "",
        width_mm: config?.width_mm || 80,
        height_mm: config?.height_mm || 90,
        net_weight:
          config?.net_weight ||
          (sku.pack_size_qty
            ? `${sku.pack_size_qty} ${sku.pack_size_uom || ""}`
            : ""),
        storage_instructions: config?.storage_instructions || "",
        shelf_life_days: config?.shelf_life_days ?? sku.shelf_life_days ?? "",
        expiry_rule: config?.expiry_rule || "production",
        content: {
          ...Object.fromEntries(
            labelContentFields.map(([key]) => [key, sku[key] || ""]),
          ),
          ...config?.content,
        },
      };
}
export function templateLabelDraft(data) {
  return data.draft?.state === "draft"
    ? {
        ...data.draft.payload,
        definition: editableLabelDefinition(data.draft.payload.definition),
      }
    : {
        name: data.published?.name || "New label template",
        width_mm: data.published?.definition?.width_mm || 80,
        height_mm: data.published?.definition?.height_mm || 90,
        definition: data.published?.definition
          ? editableLabelDefinition(data.published.definition)
          : {
              elements: [
                {
                  type: "text",
                  field: "product_name",
                  x: 5,
                  y: 5,
                  w: 70,
                  h: 12,
                  size: 4,
                  bold: true,
                },
              ],
            },
      };
}
export function labelPreviewSnapshot(payload, definition, sku = {}) {
  sku ||= {};
  const content = payload.content || {};
  return {
    ...sku,
    product_code: sku.product_code || "SKU",
    variant_name: sku.variant_name || "Packaging size",
    ...Object.fromEntries(
      labelContentFields.map(([key]) => [key, content[key] ?? sku[key] ?? ""]),
    ),
    product_name: content.product_name ?? sku.product_name ?? "Product name",
    net_weight: payload.net_weight || "Net weight",
    storage_instructions: payload.storage_instructions || "",
    width_mm: Number(payload.width_mm),
    height_mm: Number(payload.height_mm),
    definition,
    content,
    manufacturing_date: "DD/MM/YYYY",
    expiry_date: "DD/MM/YYYY",
    batch_no: "BATCH",
    packaged_units: "PACKS",
  };
}
export function updateLabelElement(definition, index, patch) {
  return {
    ...definition,
    elements: definition.elements.map((e, i) =>
      i === index ? { ...e, ...patch } : e,
    ),
  };
}
export function moveLabelElement(
  element,
  dx,
  dy,
  width,
  height,
  resize = false,
) {
  const round = (n) => Math.round(n * 10) / 10;
  return resize
    ? {
        ...element,
        w: round(Math.max(0.5, Math.min(width - element.x, element.w + dx))),
        h: round(Math.max(0.5, Math.min(height - element.y, element.h + dy))),
      }
    : {
        ...element,
        x: round(Math.max(0, Math.min(width - element.w, element.x + dx))),
        y: round(Math.max(0, Math.min(height - element.h, element.y + dy))),
      };
}

export function editableLabelDefinition(definition) {
  return {
    ...definition,
    elements: definition.elements.map((element, index) => {
      const field = legacyLabelContentField(definition, index);
      if (!field) return element;
      const { text, ...layout } = element;
      return { ...layout, field };
    }),
  };
}
export function labelElementName(element, index = 0, elements = []) {
  const field = element.field;
  if (field)
    return (
      labelFieldOptions
        .find((option) => option.value === field)
        ?.label.replace(" — from Production", "") || field
    );
  return (
    element.text?.trim().replace(/\n/g, " ").slice(0, 45) ||
    {
      rect: "Border",
      line: "Divider line",
      image: "Image",
      qr: "QR code",
      barcode: "Barcode",
      text: "Static text",
    }[element.type]
  );
}
export function labelElementSource(element) {
  return !element.field
    ? "static"
    : productionLabelFields.includes(element.field)
      ? "production"
      : "sku";
}
export function reorderLabelElement(definition, index, destination) {
  const elements = [...definition.elements];
  if (destination < 0 || destination >= elements.length) return definition;
  const [element] = elements.splice(index, 1);
  elements.splice(destination, 0, element);
  return { ...definition, elements };
}
export function labelContentWarnings(payload, definition) {
  const fields = new Set(
    definition.elements.map(
      (element, index) =>
        element.field || legacyLabelContentField(definition, index),
    ),
  );
  return labelContentFields
    .filter(([key]) => fields.has(key) && !payload.content?.[key]?.trim())
    .map(
      ([, label]) =>
        `${label} is empty for this SKU. Template sample content is not used.`,
    );
}
