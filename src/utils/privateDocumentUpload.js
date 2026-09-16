import { inspectImageBlob, optimizeImageBlob } from "./imageUpload.js";

export const PRIVATE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const PRIVATE_DOCUMENT_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

const supportedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const imageExtension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function normalizedMimeType(value) {
  const type = String(value || "").trim().toLowerCase();
  return type === "image/jpg" ? "image/jpeg" : type;
}

export function detectSupportedDocumentMime(bytes) {
  const header = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  if (header.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => header[index] === value)) return "image/png";
  if (header.length >= 12 && String.fromCharCode(...header.slice(0, 4)) === "RIFF" && String.fromCharCode(...header.slice(8, 12)) === "WEBP") return "image/webp";
  const pdfHeader = new TextDecoder("ascii").decode(header.slice(0, 1024));
  if (pdfHeader.includes("%PDF-")) return "application/pdf";
  return "";
}

export async function inspectPrivateDocument(file) {
  if (!file) throw new Error("Please select a receipt.");
  if (!file.size || file.size > PRIVATE_DOCUMENT_MAX_BYTES) throw new Error("Receipt must be 10MB or smaller.");
  const signature = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const detectedType = detectSupportedDocumentMime(signature);
  const declaredType = normalizedMimeType(file.type);
  if (!supportedMimeTypes.has(detectedType) || (declaredType && declaredType !== detectedType)) {
    throw new Error("Upload a valid JPG, PNG, WebP or PDF receipt.");
  }
  return { detectedType, declaredType };
}

export async function preparePrivateDocument(file) {
  const { detectedType } = await inspectPrivateDocument(file);
  if (detectedType === "application/pdf") {
    return {
      blob: file,
      contentType: detectedType,
      extension: "pdf",
      size: file.size,
      optimized: false,
    };
  }
  const dimensions = await inspectImageBlob(file);
  if (Math.max(dimensions.width, dimensions.height) <= 2000) {
    return {
      blob: file,
      contentType: detectedType,
      extension: imageExtension[detectedType],
      size: file.size,
      width: dimensions.width,
      height: dimensions.height,
      optimized: false,
    };
  }
  const optimized = await optimizeImageBlob(file, {
    maxLongSide: 2000,
    quality: 0.9,
  });
  const optimizedSignature = new Uint8Array(await optimized.blob.slice(0, 16).arrayBuffer());
  if (!optimized.blob.size || detectSupportedDocumentMime(optimizedSignature) !== optimized.contentType) {
    throw new Error("The optimized receipt could not be verified. Please try another file.");
  }
  return { ...optimized, size: optimized.blob.size, optimized: true };
}
