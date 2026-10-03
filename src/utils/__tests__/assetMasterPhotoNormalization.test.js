import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeAssetMasterPhoto, ASSET_MASTER_PHOTO_VARIANTS, containedImageDimensions, coveredImageDimensions } from "../imageUpload.js";

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

  it("uses the 4:3 crop framing for the presentation variants without stretching", () => {
    expect(coveredImageDimensions(900, 1200, 1200, 900)).toEqual({ width: 1200, height: 1600, x: 0, y: -350 });
    expect(coveredImageDimensions(1600, 900, 1200, 900, { zoom: 1.5, x: 1 })).toEqual({ width: 2400, height: 1350, x: 0, y: -225 });
  });
});


afterEach(() => vi.restoreAllMocks());
for (const type of ["image/webp", "image/png"]) {
  it(`keeps actual browser encoding metadata when canvas returns ${type}`, async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1600, height: 1200, close: vi.fn() })));
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn(), drawImage });
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback) { callback(new Blob(["encoded"], { type })); });
    const bundle = await normalizeAssetMasterPhoto(new File(["source"], "camera.jpg", { type: "image/jpeg" }));
    for (const variant of Object.values(bundle)) {
      expect(variant.contentType).toBe(type);
      expect(variant.extension).toBe(type.split("/")[1]);
      expect(variant.blob.type).toBe(type);
    }
    expect(bundle.display).toMatchObject({ width: 1200, height: 900 });
    expect(bundle.thumbnail).toMatchObject({ width: 400, height: 300 });
    vi.unstubAllGlobals();
  });
}
