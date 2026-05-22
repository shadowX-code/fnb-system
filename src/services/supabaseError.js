export function formatSupabaseError(error) {
  if (!error) return "Unknown system error";
  const clean = (value) => String(value)
    .replace(/Supabase/gi, "the system")
    .replace(/row-level security policy/gi, "access rule")
    .replace(/\bRLS\b/gi, "access control")
    .replace(/\bupsert\b/gi, "save")
    .replace(/\bschema\b/gi, "setup")
    .replace(/\bUUID\b/gi, "record ID")
    .replace(/\bAPI\b/gi, "service")
    .replace(/\bpayload\b/gi, "data")
    .replace(/\bmigration\b/gi, "setup update")
    .replace(/\bdatabase\b/gi, "records")
    .replace(/\bquery\b/gi, "request")
    .replace(/\bpolicy\b/gi, "access rule");
  const parts = [
    error.message ? clean(error.message) : "",
    error.details ? `Details: ${clean(error.details)}` : "",
    error.hint ? `Hint: ${clean(error.hint)}` : "",
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
