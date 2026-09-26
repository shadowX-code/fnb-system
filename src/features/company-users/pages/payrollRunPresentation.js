// Display explanations only; calculation and readiness stay server-owned.
export function payrollIssueLabel(issue) {
  const [code, detail] = String(issue).split(":");
  const labels = {
    missing_effective_compensation_or_proration_policy: "Pay is not established for the full period; an approved proration policy is required.",
    partial_month_requires_approved_proration: "Partial-month pay requires an approved proration policy.",
    monthly_rate_change_requires_proration_policy: "The salary changed during this period; an approved proration policy is required.",
    mid_period_component_change: "A recurring component changes during this period; its period treatment requires review.",
    statutory_applicability_missing: "Statutory applicability is not established at the start of this period.",
    mid_period_statutory_applicability_change: "Statutory applicability changes within this period and requires review.",
    mid_period_statutory_input_change: "Contribution categories change within this period and require review.",
    phase3_calculation_missing_or_stale: "Refresh payroll after resolving employee inputs.",
    employment_start_date_requires_review: "Confirm the employee's commencement date in Employee setup.",
    unreconciled_time: "Refresh payable time evidence",
    unresolved_time_exception: "Resolve the payable time exception",
    stale_time_evidence: "Work evidence changed; refresh payable time",
    missing_payroll_profile: "Set up this employee's pay before calculating payroll.",
  };
  const text = labels[code] || code.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return /^\d{4}-\d{2}-\d{2}$/.test(detail || "") ? `${text} · ${detail}` : text;
}
