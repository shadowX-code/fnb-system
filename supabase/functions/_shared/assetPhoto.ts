const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const isAssetPhotoType = (type: string) => Object.hasOwn(extensions, type);
export function assetPhotoExtension(type: string) {
  if (!isAssetPhotoType(type)) throw new Error("Unsupported Asset photo format.");
  return extensions[type];
}
