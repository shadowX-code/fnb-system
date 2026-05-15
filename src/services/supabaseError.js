export function formatSupabaseError(error) {
  if (!error) return "Unknown Supabase error";
  const parts = [
    error.message,
    error.details ? `Details: ${error.details}` : "",
    error.hint ? `Hint: ${error.hint}` : "",
    error.code ? `Code: ${error.code}` : "",
  ].filter(Boolean);
  return parts.join(" | ");
}

export function logSupabaseError(scope, error) {
  console.error(`[Supabase:${scope}]`, {
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
    code: error?.code,
    raw: error,
  });
}

export function throwSupabaseError(scope, error) {
  if (!error) return;
  logSupabaseError(scope, error);
  const detailedError = new Error(formatSupabaseError(error));
  detailedError.cause = error;
  throw detailedError;
}
