import { describe, expect, it } from "vitest";
import { assetPhotoExtension, isAssetPhotoType } from "../../../supabase/functions/_shared/assetPhoto.ts";
describe("Asset Edge photo formats", () => {
  it("accepts browser fallback formats with matching storage extensions", () => {
    for (const [type, extension] of [["image/webp", "webp"], ["image/png", "png"], ["image/jpeg", "jpg"]]) {
      expect(isAssetPhotoType(type)).toBe(true);
      expect(assetPhotoExtension(type)).toBe(extension);
    }
  });
  it("rejects active or unsupported formats", () => {
    for (const type of ["image/svg+xml", "text/html", "image/heic", ""]) {
      expect(isAssetPhotoType(type)).toBe(false);
      expect(() => assetPhotoExtension(type)).toThrow();
    }
  });
});
