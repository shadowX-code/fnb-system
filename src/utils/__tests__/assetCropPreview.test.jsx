import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import AssetPhotoCropper from "../../components/media/AssetPhotoCropper.jsx";
import { coveredImageDimensions, ASSET_MASTER_PHOTO_VARIANTS } from "../imageUpload.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function loadedPreview(width, height, crop = {}, onChange = vi.fn()) {
  const view = render(<AssetPhotoCropper src="blob:source" crop={crop} onChange={onChange} />);
  const image = view.getByAltText("Asset photo crop preview");
  Object.defineProperties(image, { naturalWidth: { value: width }, naturalHeight: { value: height } });
  fireEvent.load(image);
  return { ...view, image, onChange };
}
describe("Asset crop preview and saved presentation", () => {
  for (const [width, height] of [[900, 1200], [1600, 900], [900, 900]]) {
    for (const crop of [{}, { zoom: 1.7, x: 0.45, y: -0.65 }, { zoom: 3, x: -1, y: 1 }]) {
      it(`renders the saved framing for ${width}x${height} ${JSON.stringify(crop)}`, () => {
        const { image } = loadedPreview(width, height, crop);
        const frame = ASSET_MASTER_PHOTO_VARIANTS.display;
        const bounds = coveredImageDimensions(width, height, frame.width, frame.height, crop);
        expect(parseFloat(image.style.left) * frame.width / 100).toBeCloseTo(bounds.x);
        expect(parseFloat(image.style.top) * frame.height / 100).toBeCloseTo(bounds.y);
        expect(parseFloat(image.style.width) * frame.width / 100).toBeCloseTo(bounds.width);
        expect(parseFloat(image.style.height) * frame.height / 100).toBeCloseTo(bounds.height);
        expect(image.style.transform).toBe("");
        expect(bounds.x).toBeLessThanOrEqual(0);
        expect(bounds.y).toBeLessThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(frame.width);
        expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(frame.height);
        const thumb = coveredImageDimensions(width, height, 400, 300, crop);
        for (const key of ["width", "height", "x", "y"]) expect(Math.abs(thumb[key] * 3 - bounds[key])).toBeLessThanOrEqual(2);
      });
    }
  }
  it("moves the visible image by the dragged distance without exposing empty frame edges", () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    const { image, onChange } = loadedPreview(900, 1200);
    const frame = image.parentElement;
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({ width: 360, height: 270 });
    fireEvent.pointerDown(frame, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(frame, { clientX: 150, clientY: 130 });
    expect(onChange).toHaveBeenLastCalledWith({ zoom: 1, x: 0, y: 2 * 30 / 210 });
    fireEvent.pointerMove(frame, { clientX: 150, clientY: 1000 });
    expect(onChange).toHaveBeenLastCalledWith({ zoom: 1, x: 0, y: 1 });
  });
});
