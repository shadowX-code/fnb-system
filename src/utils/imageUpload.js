import { supabase } from "../lib/supabase.ts";

export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_UPLOAD_ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
export const IMAGE_UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp";
export const IMAGE_UPLOAD_LIMIT_MESSAGE = "Image exceeds 5MB limit.";

const OPTIMIZED_MIME_TYPE = "image/webp";
const OPTIMIZED_EXTENSION = "webp";
const MAX_LONG_SIDE = 1920;
const QUALITY = 0.8;

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

function loadImageFromObjectUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to read image. Please try another file."));
    image.src = url;
  });
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || "");
    reader.onerror = () => reject(new Error("Unable to read image. Please try another file."));
    reader.readAsDataURL(blob);
  });
}

export async function optimizeImageBlob(fileOrBlob) {
  const url = URL.createObjectURL(fileOrBlob);
  try {
    const image = await loadImageFromObjectUrl(url);
    const sourceWidth = image.naturalWidth || image.width || 0;
    const sourceHeight = image.naturalHeight || image.height || 0;
    if (!sourceWidth || !sourceHeight) throw new Error("Unable to read image dimensions.");
    const scale = Math.min(1, MAX_LONG_SIDE / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to optimize image in this browser.");
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("Unable to optimize image. Please try another file."));
      }, OPTIMIZED_MIME_TYPE, QUALITY);
    });
    return {
      blob,
      width,
      height,
      extension: OPTIMIZED_EXTENSION,
      contentType: OPTIMIZED_MIME_TYPE,
    };
  } finally {
    URL.revokeObjectURL(url);
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

export async function uploadOptimizedImage(fileOrBlob, { bucket, path, previousPublicUrl = "", metadata = {} }) {
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
  if (previousPublicUrl && previousPublicUrl !== publicUrlData.publicUrl) {
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
