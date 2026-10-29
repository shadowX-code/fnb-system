import { describe, it, expect } from "vitest";
import {
  mmToDots,
  packMonochrome,
  barcodeModules,
  validateDefinition,
} from "../labelRenderer.js";

describe("label print pixels and template boundaries", () => {
  it("renders 80×90 mm at the nearest physical 203 DPI dot", () => {
    expect(mmToDots(80)).toBe(639);
    expect(mmToDots(90)).toBe(719);
  });
  it("packs rows independently, high bit first, with white padding", () => {
    const rgba = new Uint8Array(9 * 2 * 4).fill(255);
    for (const pixel of [0, 8, 10]) {
      rgba[pixel * 4] = rgba[pixel * 4 + 1] = rgba[pixel * 4 + 2] = 0;
    }
    expect([...packMonochrome(rgba, 9, 2)]).toEqual([128, 128, 64, 0]);
  });
  it("does not print transparent black", () => {
    expect([...packMonochrome(new Uint8Array([0, 0, 0, 0]), 1, 1)]).toEqual([
      0,
    ]);
  });
  it("encodes Code 39 start and stop with quiet zones and rejects corrupt input", () => {
    const modules = barcodeModules("S08-26");
    expect(modules.slice(0, 10)).toEqual(Array(10).fill(0));
    expect(modules.slice(-10)).toEqual(Array(10).fill(0));
    expect(modules.length).toBe(148);
    expect(() => barcodeModules("虾米")).toThrow(/Code 39/);
    expect(() => barcodeModules("a")).toThrow();
  });
  it("rejects elements outside media, unsafe images and unsupported fields", () => {
    const element = {
      type: "text",
      field: "product_name",
      x: 5,
      y: 5,
      w: 70,
      h: 9,
      size: 3,
    };
    expect(
      validateDefinition({ elements: [element] }, 80, 90).elements,
    ).toHaveLength(1);
    expect(() =>
      validateDefinition({ elements: [{ ...element, w: 76 }] }, 80, 90),
    ).toThrow(/fit/);
    expect(() =>
      validateDefinition(
        { elements: [{ ...element, field: "password" }] },
        80,
        90,
      ),
    ).toThrow(/field/);
    expect(() =>
      validateDefinition(
        {
          elements: [
            { ...element, type: "image", src: "https://example.com/logo.png" },
          ],
        },
        80,
        90,
      ),
    ).toThrow(/embedded PNG/);
  });
});
