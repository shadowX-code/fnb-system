import { beforeEach, describe, expect, it, vi } from "vitest";
import { inspectImageBlob, optimizeImageBlob } from "../imageUpload.js";
import { detectSupportedDocumentMime, inspectPrivateDocument, preparePrivateDocument, PRIVATE_DOCUMENT_MAX_BYTES } from "../privateDocumentUpload.js";

vi.mock("../imageUpload.js", () => ({
  inspectImageBlob: vi.fn(),
  optimizeImageBlob: vi.fn(),
}));

function fileWithHeader(header, { name, type, size } = {}) {
  const padding = Math.max(0, (size || header.length) - header.length);
  return new File([header, new Uint8Array(padding)], name || "receipt.bin", { type: type || "" });
}

const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webpHeader = new TextEncoder().encode("RIFF0000WEBP");
const pdfHeader = new TextEncoder().encode("%PDF-1.7 receipt");

beforeEach(() => {
  vi.clearAllMocks();
  inspectImageBlob.mockResolvedValue({ width: 1200, height: 1800 });
});

describe("private document uploads", () => {
  it("detects supported binary signatures instead of trusting extensions", () => {
    expect(detectSupportedDocumentMime(jpegHeader)).toBe("image/jpeg");
    expect(detectSupportedDocumentMime(pngHeader)).toBe("image/png");
    expect(detectSupportedDocumentMime(webpHeader)).toBe("image/webp");
    expect(detectSupportedDocumentMime(pdfHeader)).toBe("application/pdf");
  });

  it("rejects mismatched, corrupt and oversized sources", async () => {
    await expect(inspectPrivateDocument(fileWithHeader(pdfHeader, { name: "fake.jpg", type: "image/jpeg" }))).rejects.toThrow("valid JPG, PNG, WebP or PDF");
    await expect(inspectPrivateDocument(fileWithHeader(new Uint8Array([1, 2, 3]), { name: "bad.pdf", type: "application/pdf" }))).rejects.toThrow("valid JPG, PNG, WebP or PDF");
    await expect(inspectPrivateDocument(fileWithHeader(pdfHeader, { name: "large.pdf", type: "application/pdf", size: PRIVATE_DOCUMENT_MAX_BYTES + 1 }))).rejects.toThrow("10MB or smaller");
  });

  it("preserves PDFs and reasonably sized images without recompression", async () => {
    const pdf = fileWithHeader(pdfHeader, { name: "receipt.pdf", type: "application/pdf" });
    const image = fileWithHeader(jpegHeader, { name: "receipt.jpg", type: "image/jpeg" });
    const preparedPdf = await preparePrivateDocument(pdf);
    const preparedImage = await preparePrivateDocument(image);
    expect(preparedPdf.blob).toBe(pdf);
    expect(preparedPdf.optimized).toBe(false);
    expect(preparedImage.blob).toBe(image);
    expect(preparedImage.contentType).toBe("image/jpeg");
    expect(preparedImage.optimized).toBe(false);
    expect(optimizeImageBlob).not.toHaveBeenCalled();
  });

  it("resizes a materially oversized image once at high quality without a byte target", async () => {
    inspectImageBlob.mockResolvedValue({ width: 4032, height: 3024 });
    const optimizedBlob = new Blob([webpHeader, new Uint8Array(2 * 1024 * 1024)], { type: "image/webp" });
    optimizeImageBlob.mockResolvedValue({ blob: optimizedBlob, width: 2000, height: 1500, extension: "webp", contentType: "image/webp" });
    const image = fileWithHeader(pngHeader, { name: "phone.png", type: "image/png" });
    const prepared = await preparePrivateDocument(image);
    expect(optimizeImageBlob).toHaveBeenCalledWith(image, { maxLongSide: 2000, quality: 0.9 });
    expect(prepared.size).toBeGreaterThan(1024 * 1024);
    expect(prepared.optimized).toBe(true);
  });
});
