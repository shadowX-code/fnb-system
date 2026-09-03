const UOM_ALIASES = {
  kilogram: "kg", kilograms: "kg", gram: "g", grams: "g",
  l: "litre", liter: "litre", liters: "litre", litres: "litre",
  millilitre: "ml", milliliter: "ml", millilitres: "ml", milliliters: "ml",
};

const DIMENSIONAL_UNITS = {
  kg: { dimension: "weight", toBase: 1000, display: "kg" },
  g: { dimension: "weight", toBase: 1, display: "g" },
  litre: { dimension: "volume", toBase: 1000, display: "L" },
  ml: { dimension: "volume", toBase: 1, display: "ml" },
};

export const commonFactoryUoms = ["kg", "g", "litre", "ml", "pcs", "carton", "pail", "bottle", "bag", "pack"];

export function normalizeFactoryUom(uom) {
  const value = String(uom || "").trim().toLowerCase();
  return UOM_ALIASES[value] || value;
}

export function dimensionalFactoryUom(uom) {
  return DIMENSIONAL_UNITS[normalizeFactoryUom(uom)] || null;
}

export function factoryUsageUomOptions(material = {}) {
  const options = new Set([normalizeFactoryUom(material.uom)]);
  const packageUom = normalizeFactoryUom(material.conversion_package_uom);
  const baseUom = normalizeFactoryUom(material.conversion_base_uom);
  const base = dimensionalFactoryUom(baseUom);
  const storage = dimensionalFactoryUom(material.uom);
  if (base) {
    options.add(packageUom);
    Object.entries(DIMENSIONAL_UNITS).filter(([, value]) => value.dimension === base.dimension).forEach(([uom]) => options.add(uom));
  } else if (storage) {
    Object.entries(DIMENSIONAL_UNITS).filter(([, value]) => value.dimension === storage.dimension).forEach(([uom]) => options.add(uom));
  }
  return [...options].filter(Boolean).map((value) => ({ value, label: dimensionalFactoryUom(value)?.display || value }));
}

export function convertRawMaterialQuantity(quantityValue, fromUom, toUom, material = {}) {
  const quantity = Number(quantityValue || 0);
  const from = normalizeFactoryUom(fromUom);
  const to = normalizeFactoryUom(toUom);
  if (!Number.isFinite(quantity) || quantity < 0 || !from || !to) return { quantity: null, reason: "Usage and target UOM are required." };
  if (from === to) return { quantity, reason: "" };
  const fromDimension = dimensionalFactoryUom(from);
  const toDimension = dimensionalFactoryUom(to);
  if (fromDimension && toDimension && fromDimension.dimension === toDimension.dimension) {
    return { quantity: (quantity * fromDimension.toBase) / toDimension.toBase, reason: "" };
  }
  const packageUom = normalizeFactoryUom(material.conversion_package_uom);
  const baseUom = normalizeFactoryUom(material.conversion_base_uom);
  const packageQuantity = Number(material.conversion_package_quantity || 0);
  const baseDimension = dimensionalFactoryUom(baseUom);
  if (!packageUom || !baseDimension || packageQuantity <= 0) return { quantity: null, reason: "Missing UOM conversion" };
  let baseQuantity;
  if (from === packageUom) baseQuantity = quantity * packageQuantity;
  else if (fromDimension && fromDimension.dimension === baseDimension.dimension) baseQuantity = (quantity * fromDimension.toBase) / baseDimension.toBase;
  else return { quantity: null, reason: "Missing UOM conversion" };
  if (to === packageUom) return { quantity: baseQuantity / packageQuantity, reason: "" };
  if (toDimension && toDimension.dimension === baseDimension.dimension) return { quantity: (baseQuantity * baseDimension.toBase) / toDimension.toBase, reason: "" };
  return { quantity: null, reason: "Missing UOM conversion" };
}
