export function isFactoryPermissionError(error) {
  const source = error?.cause || error;
  const code = String(error?.code || source?.code || "").toUpperCase();
  const status = Number(error?.status || error?.statusCode || source?.status || source?.statusCode || 0);
  const message = String(error?.message || source?.message || "").toLowerCase();
  return code === "42501"
    || status === 401
    || status === 403
    || message.includes("permission denied")
    || message.includes("insufficient permission")
    || message.includes("not authorized")
    || message.includes("unauthorized")
    || message.includes("forbidden");
}
