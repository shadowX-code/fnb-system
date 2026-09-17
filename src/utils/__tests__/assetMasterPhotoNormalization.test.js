import { describe, expect, it } from "vitest";
import { ASSET_MASTER_PHOTO_VARIANTS, containedImageDimensions } from "../imageUpload.js";

describe("Asset master photo normalization geometry", () => {
  it("contains a portrait source within the canonical 4:3 display canvas", () => {
    expect(containedImageDimensions(900, 1200, ASSET_MASTER_PHOTO_VARIANTS.display.width, ASSET_MASTER_PHOTO_VARIANTS.display.height))
      .toEqual({ width: 675, height: 900, x: 263, y: 0 });
  });

  it("contains landscape and square sources without stretching or cropping", () => {
    expect(containedImageDimensions(1600, 900, 1200, 900)).toEqual({ width: 1200, height: 675, x: 0, y: 113 });
    expect(containedImageDimensions(900, 900, 400, 300)).toEqual({ width: 300, height: 300, x: 50, y: 0 });
  });

  it("rejects invalid source dimensions before a canvas can be rendered", () => {
    expect(() => containedImageDimensions(0, 900, 1200, 900)).toThrow(/dimensions/i);
  });
});
