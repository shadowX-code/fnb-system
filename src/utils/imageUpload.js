import { supabase } from "../lib/supabase.ts";

export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_UPLOAD_ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
export const IMAGE_UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp";
export const IMAGE_UPLOAD_LIMIT_MESSAGE = "Image exceeds 5MB limit.";

const OPTIMIZED_MIME_TYPE = "image/webp";
const OPTIMIZED_EXTENSION = "webp";
const MAX_LONG_SIDE = 1920;
const QUALITY = 0.8;
export const ASSET_MASTER_PHOTO_VARIANTS = {
  display: { width: 1200, height: 900, quality: 0.82 },
  thumbnail: { width: 400, height: 300, quality: 0.78 },
};
const ASSET_MASTER_PHOTO_BACKGROUND = "#f4f5f4";
export const ASSET_MASTER_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";
export const ASSET_MASTER_PHOTO_MAX_BYTES = 25 * 1024 * 1024;
const ASSET_MASTER_SOURCE_LONG_SIDE = 1920;

export function imageExtensionFromName(name = "", fallback = "") {
  const extension = String(name || "").split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || fallback;
  return extension === "jpg" ? "jpeg" : extension;
}

export function isAllowedImageFile(file) {
  const typeExtension = String(file?.type || "").split("/").pop()?.toLowerCase() || "";
  const nameExtension = imageExtensionFromName(file?.name || "", typeExtension);
  return IMAGE_UPLOAD_ALLOWED_EXTENSIONS.has(typeExtension === "jpg" ? "jpeg" : typeExtension)
    || IMAGE_UPLOAD_ALLOWED_EXTENSIONS.has(nameExtension === "jpg" ? "jpeg" : nameExtension);
}

export function validateImageFile(file) {
  if (!file) throw new Error("Please select an image.");
  if (!isAllowedImageFile(file)) throw new Error("Please upload a JPG, PNG, or WebP image.");
  if (file.size > IMAGE_UPLOAD_MAX_BYTES) throw new Error(IMAGE_UPLOAD_LIMIT_MESSAGE);
}

export function validateAssetMasterPhotoFile(file) {
  if (!file) throw new Error("Please select a photo.");
  const type = String(file.type || "").toLowerCase();
  const extension = imageExtensionFromName(file.name || "", type.split("/").pop() || "");
  if (!isAllowedImageFile(file) && !["image/heic", "image/heif"].includes(type) && !["heic", "heif"].includes(extension)) {
    throw new Error("Choose a JPG, PNG, WebP, HEIC, or HEIF photo.");
  }
  if (!file.size || file.size > ASSET_MASTER_PHOTO_MAX_BYTES) {
    throw new Error("That photo is too large to prepare on this device. Choose a smaller photo and try again.");
  }
}

export function validateLearningImageFile(file) {
  if (!file) throw new Error("Please select an image.");
  if (!IMAGE_UPLOAD_ALLOWED_EXTENSIONS.has(String(file.type || "").split("/").pop()?.toLowerCase())) {
    throw new Error("Please upload a JPG, PNG, or WebP image.");
  }
  if (file.size <= 0 || file.size > IMAGE_UPLOAD_MAX_BYTES) throw new Error(IMAGE_UPLOAD_LIMIT_MESSAGE);
}

function loadImageFromObjectUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to read image. Please try another file."));
    image.src = url;
  });
}

async function decodeImage(blob) {
  if (typeof globalThis.createImageBitmap === "function") {
    try {
      const bitmap = await globalThis.createImageBitmap(blob, { imageOrientation: "from-image" });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
    } catch {
      // Fall through to the broadly supported object URL decoder.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImageFromObjectUrl(url);
    return {
      image,
      width: image.naturalWidth || image.width || 0,
      height: image.naturalHeight || image.height || 0,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function inspectImageBlob(blob) {
  const decoded = await decodeImage(blob);
  try {
    if (!decoded.width || !decoded.height) throw new Error("Unable to read image dimensions.");
    return { width: decoded.width, height: decoded.height };
  } finally {
    decoded.close();
  }
}

function canvasToBlob(canvas, contentType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Unable to optimize image. Please try another file."));
    }, contentType, quality);
  });
}

export function containedImageDimensions(sourceWidth, sourceHeight, canvasWidth, canvasHeight) {
  if (!sourceWidth || !sourceHeight || !canvasWidth || !canvasHeight) {
    throw new Error("Unable to read image dimensions.");
  }
  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return {
    width,
    height,
    x: Math.round((canvasWidth - width) / 2),
    y: Math.round((canvasHeight - height) / 2),
  };
}

async function containedVariant(decoded, { width, height, quality }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to normalize image. Please try another file.");
  const bounds = containedImageDimensions(decoded.width, decoded.height, width, height);
  context.fillStyle = ASSET_MASTER_PHOTO_BACKGROUND;
  context.fillRect(0, 0, width, height);
  context.drawImage(decoded.image, bounds.x, bounds.y, bounds.width, bounds.height);
  const blob = await canvasToBlob(canvas, OPTIMIZED_MIME_TYPE, quality);
  return { blob, width, height, contentType: OPTIMIZED_MIME_TYPE, extension: OPTIMIZED_EXTENSION };
}

function normalizedCrop(crop = {}) {
  return {
    zoom: Math.min(3, Math.max(1, Number(crop.zoom) || 1)),
    x: Math.min(1, Math.max(-1, Number(crop.x) || 0)),
    y: Math.min(1, Math.max(-1, Number(crop.y) || 0)),
  };
}

function coveredImageDimensions(sourceWidth, sourceHeight, canvasWidth, canvasHeight, crop = {}) {
  if (!sourceWidth || !sourceHeight || !canvasWidth || !canvasHeight) throw new Error("Unable to read image dimensions.");
  const normalized = normalizedCrop(crop);
  const scale = Math.max(canvasWidth / sourceWidth, canvasHeight / sourceHeight) * normalized.zoom;
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const maxX = Math.max(0, width - canvasWidth);
  const maxY = Math.max(0, height - canvasHeight);
  return {
    width, height,
    x: Math.round(-maxX / 2 + (maxX / 2) * normalized.x),
    y: Math.round(-maxY / 2 + (maxY / 2) * normalized.y),
  };
}

async function coveredVariant(decoded, { width, height, quality }, crop) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to normalize image. Please try another file.");
  const bounds = coveredImageDimensions(decoded.width, decoded.height, width, height, crop);
  context.fillStyle = ASSET_MASTER_PHOTO_BACKGROUND;
  context.fillRect(0, 0, width, height);
  context.drawImage(decoded.image, bounds.x, bounds.y, bounds.width, bounds.height);
  const blob = await canvasToBlob(canvas, OPTIMIZED_MIME_TYPE, quality);
  return { blob, width, height, contentType: OPTIMIZED_MIME_TYPE, extension: OPTIMIZED_EXTENSION };
}

// Asset master media keeps the supplied file intact and derives fixed 4:3
// presentation variants. Inspection evidence continues through optimizeImageBlob.
export async function normalizeAssetMasterPhoto(file, crop = {}) {
  validateAssetMasterPhotoFile(file);
  const decoded = await decodeImage(file);
  try {
    if (!decoded.width || !decoded.height) throw new Error("Unable to read image dimensions.");
    const [display, thumbnail] = await Promise.all([
      coveredVariant(decoded, ASSET_MASTER_PHOTO_VARIANTS.display, crop),
      coveredVariant(decoded, ASSET_MASTER_PHOTO_VARIANTS.thumbnail, crop),
    ]);
    const sourceCanvas = document.createElement("canvas");
    const scale = Math.min(1, ASSET_MASTER_SOURCE_LONG_SIDE / Math.max(decoded.width, decoded.height));
    sourceCanvas.width = Math.max(1, Math.round(decoded.width * scale));
    sourceCanvas.height = Math.max(1, Math.round(decoded.height * scale));
    const sourceContext = sourceCanvas.getContext("2d");
    if (!sourceContext) throw new Error("Unable to normalize image. Please try another file.");
    sourceContext.drawImage(decoded.image, 0, 0, sourceCanvas.width, sourceCanvas.height);
    const sourceBlob = await canvasToBlob(sourceCanvas, OPTIMIZED_MIME_TYPE, 0.86);
    return {
      original: {
        blob: sourceBlob,
        contentType: OPTIMIZED_MIME_TYPE,
        extension: OPTIMIZED_EXTENSION,
      },
      display,
      thumbnail,
    };
  } finally {
    decoded.close();
  }
}

export async function assetMasterPhotoPreview(file, crop = {}) {
  const bundle = await normalizeAssetMasterPhoto(file, crop);
  return URL.createObjectURL(bundle.display.blob);
}

export { coveredImageDimensions, normalizedCrop };

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || "");
    reader.onerror = () => reject(new Error("Unable to read image. Please try another file."));
    reader.readAsDataURL(blob);
  });
}

export async function optimizeImageBlob(fileOrBlob, options = {}) {
  const maxLongSide = Number(options.maxLongSide || MAX_LONG_SIDE);
  const contentType = options.contentType || OPTIMIZED_MIME_TYPE;
  const extension = options.extension || OPTIMIZED_EXTENSION;
  const initialQuality = Number(options.quality ?? QUALITY);
  const decoded = await decodeImage(fileOrBlob);
  try {
    const sourceWidth = decoded.width;
    const sourceHeight = decoded.height;
    if (!sourceWidth || !sourceHeight) throw new Error("Unable to read image dimensions.");
    const scale = Math.min(1, maxLongSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to optimize image in this browser.");
    context.drawImage(decoded.image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, contentType, initialQuality);
    const verification = await decodeImage(blob);
    try {
      if (verification.width !== width || verification.height !== height) {
        throw new Error("The optimized image could not be verified. Please try another file.");
      }
    } finally {
      verification.close();
    }
    return {
      blob,
      width,
      height,
      extension,
      contentType,
    };
  } finally {
    decoded.close();
  }
}

export async function optimizeImageFileForPreview(file) {
  validateImageFile(file);
  const optimized = await optimizeImageBlob(file);
  return {
    ...optimized,
    dataUrl: await blobToDataUrl(optimized.blob),
  };
}

export async function dataUrlToOptimizedBlob(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  if (blob.size > IMAGE_UPLOAD_MAX_BYTES) throw new Error(IMAGE_UPLOAD_LIMIT_MESSAGE);
  if (!String(blob.type || "").startsWith("image/")) throw new Error("Please upload a JPG, PNG, or WebP image.");
  return optimizeImageBlob(blob);
}

export function isImageDataUrl(value) {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(String(value || ""));
}

export function storagePathFromPublicUrl(publicUrl, bucket) {
  const value = String(publicUrl || "");
  if (!value || !bucket) return "";
  const marker = `/storage/v1/object/public/${bucket}/`;
  const markerIndex = value.indexOf(marker);
  if (markerIndex === -1) return "";
  const pathWithQuery = value.slice(markerIndex + marker.length);
  return decodeURIComponent(pathWithQuery.split("?")[0] || "");
}

export async function removeStorageObjectFromPublicUrl(bucket, publicUrl) {
  const path = storagePathFromPublicUrl(publicUrl, bucket);
  if (!path) return { skipped: true };
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
  return { removed: true, path };
}

export async function uploadOptimizedImage(fileOrBlob, { bucket, path, previousPublicUrl = "", metadata = {}, cleanupPrevious = true }) {
  if (!bucket || !path) throw new Error("Missing image upload destination.");
  if (fileOrBlob instanceof File) validateImageFile(fileOrBlob);
  const optimized = await optimizeImageBlob(fileOrBlob);
  const finalPath = path.replace(/\.[a-z0-9]+$/i, `.${optimized.extension}`);
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(finalPath, optimized.blob, {
      contentType: optimized.contentType,
      upsert: true,
      metadata,
    });
  if (error) throw error;
  const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(data.path);
  if (cleanupPrevious && previousPublicUrl && previousPublicUrl !== publicUrlData.publicUrl) {
    try {
      await removeStorageObjectFromPublicUrl(bucket, previousPublicUrl);
    } catch (removeError) {
      console.warn("[ImageUpload] Unable to remove replaced image", removeError);
    }
  }
  return {
    bucket,
    path: data.path,
    publicUrl: publicUrlData.publicUrl,
    size: optimized.blob.size,
    width: optimized.width,
    height: optimized.height,
  };
}

export async function uploadOptimizedDataUrl(dataUrl, options) {
  const optimized = await dataUrlToOptimizedBlob(dataUrl);
  return uploadOptimizedImage(optimized.blob, options);
}

export async function uploadAssetMasterPhotoBundle(file, { bucket, pathPrefix, metadata = {}, crop = {} }) {
  if (!bucket || !pathPrefix) throw new Error("Missing asset photo destination.");
  const normalized = await normalizeAssetMasterPhoto(file, crop);
  const paths = {
    original: `${pathPrefix}/original.${normalized.original.extension}`,
    display: `${pathPrefix}/display.webp`,
    thumbnail: `${pathPrefix}/thumbnail.webp`,
  };
  const uploads = [
    ["original", normalized.original],
    ["display", normalized.display],
    ["thumbnail", normalized.thumbnail],
  ];
  const completedPaths = [];
  try {
    for (const [kind, variant] of uploads) {
      const { data, error } = await supabase.storage.from(bucket).upload(paths[kind], variant.blob, {
        contentType: variant.contentType,
        cacheControl: "31536000",
        upsert: false,
        metadata: { ...metadata, asset_photo_role: kind },
      });
      if (error) throw error;
      completedPaths.push(data.path);
    }
  } catch (error) {
    if (completedPaths.length) await supabase.storage.from(bucket).remove(completedPaths);
    throw error;
  }
  const storage = supabase.storage.from(bucket);
  return {
    paths,
    original_image_url: storage.getPublicUrl(paths.original).data.publicUrl,
    image_url: storage.getPublicUrl(paths.display).data.publicUrl,
    thumbnail_url: storage.getPublicUrl(paths.thumbnail).data.publicUrl,
  };
}
