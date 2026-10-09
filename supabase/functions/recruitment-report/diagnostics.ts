// Classify only known validator messages. Never persist candidate/provider error text.
export function classifyReportFailure(stage: string, error: unknown, httpStatus?: number) {
  if (stage === "provider") {
    if (httpStatus === 429) return "provider_rate_limited";
    if (httpStatus === 401 || httpStatus === 403) return "provider_access_failed";
    if (httpStatus && httpStatus >= 400) return "provider_request_failed";
    if (error && typeof error === "object" && "name" in error && ["TimeoutError", "AbortError"].includes(String(error.name))) return "provider_timeout";
    return "provider_unavailable";
  }
  if (stage === "response_parsing") return "response_parsing_failed";
  if (stage === "persistence") return "persistence_failed";
  if (stage === "validation") {
    const message = error instanceof Error ? error.message : "";
    if (["Uncited claim", "Foreign or non-candidate citation", "Uncited covered topic", "Uncited canonical topic", "Uncited requirement fit"].includes(message)) return "citation_validation_failed";
    if (["Pinned assessments incomplete", "Invalid assessment area", "Unsupported rubric assessment"].includes(message)) return "rubric_validation_failed";
    return "report_validation_failed";
  }
  return "report_claim_failed";
}
