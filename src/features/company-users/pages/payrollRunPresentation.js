// Display explanations only; calculation and readiness stay server-owned.
export const payComponentIsConfigured = (component) => ["epf", "socso", "eis", "pcb"]
  .every(scheme => ["included", "excluded"].includes(component?.[`${scheme}_treatment`]));

// These rows already carry confirmed canonical source evidence; only pricing is pending.
export const payrollConfirmedUnpaidEvidence = line => line?.amount == null && line?.presentation_model === 'monthly_salary_partial_evidence_v1'
  ? line.code === 'unpaid_absence' ? 'Confirmed unpaid absence · Deduction pending'
    : line.code === 'unpaid_leave' ? 'Approved unpaid leave · Deduction pending' : null
  : null;

export function payrollEmployeeResult(calculation, statutory) {
  const earningsCurrent = calculation?.status === "ready" && !calculation.is_stale;
  const statutoryCurrent = earningsCurrent && statutory?.status === "ready" && !statutory.is_stale;
  return {
    earningsCurrent,
    earningsAvailable: !!calculation && !calculation.is_stale,
    statutoryCurrent,
    gross: earningsCurrent ? calculation.gross_earnings : null,
    deductions: statutoryCurrent ? Number(statutory.non_statutory_deductions || 0)
      + (statutory.lines || []).reduce((sum, line) => sum + Number(line.employee_amount || 0), 0) : null,
    net: statutoryCurrent ? statutory.net_pay : null,
    status: calculation?.is_stale || statutory?.is_stale ? "Pending Calculation"
      : !earningsCurrent ? calculation ? "Needs Attention" : "Complete Calculation"
        : !statutory ? "Complete Calculation" : statutoryCurrent ? "Ready" : "Needs Attention",
  };
}

// Aggregate persisted results for display only; never price earnings in the UI.
export function payrollRunSummary(rows = []) {
  const sum = read => rows.length && rows.every(row => read(row) != null)
    ? rows.reduce((total, row) => total + Number(read(row)), 0) : null;
  return {
    gross: sum(row => row.result.gross),
    deductions: sum(row => row.result.deductions),
    net: sum(row => row.result.net),
    employerCost: sum(row => row.result.statutoryCurrent ? row.statutory?.total_employer_cost : null),
  };
}

// Consume the canonical pay-impact projection; never infer salary consequences.
export function payrollTimeNeedsReview(row) {
  if (row.review_state) return row.review_state.required && row.review_state.state !== 'ready';
  return row.status === 'review_required' || !!row.source_state?.updated;
}

// One display projection from server results. Never prices wages or grants Finalize.
export function payrollReviewRows(evidence, finalized = false) {
  const members = finalized ? evidence?.results : evidence?.preparation?.results;
  return (members || []).map(member => {
    const calculation = finalized ? member.calculation : evidence.calculation?.results?.find(row => row.employee_id === member.employee_id);
    const statutory = finalized ? member.statutory : evidence.statutory?.results?.find(row => row.employee_id === member.employee_id);
    const result = payrollEmployeeResult(calculation, statutory);
    const timeNeedsReview = !finalized && (member.time_exception_count != null ? member.time_exception_count > 0 : member.time_relevant && (member.projection?.issues || []).some(issue => /time|attendance|clock|roster/.test(issue)));
    const payNeedsReview = !result.earningsCurrent || (!finalized && member.projection?.status !== "ready");
    const statutoryNeedsReview = !result.statutoryCurrent || (!finalized && member.statutory_setup?.complete !== true);
    return { ...member, calculation, statutory, result, timeNeedsReview, payNeedsReview, statutoryNeedsReview,
      needsReview: Boolean(timeNeedsReview || payNeedsReview || statutoryNeedsReview) };
  });
}

export function payrollReviewSummary(rows = []) {
  return { ...payrollRunSummary(rows), employeeCount: rows.length,
    readyCount: rows.filter(row => !row.needsReview).length,
    needCount: rows.filter(row => row.needsReview).length,
    timeCount: rows.filter(row => row.timeNeedsReview).length,
    payCount: rows.filter(row => row.payNeedsReview).length,
    statutoryCount: rows.filter(row => row.statutoryNeedsReview).length };
}

export function payrollIssueLabel(issue, context = {}) {
  const [code, detail] = String(issue).split(":");
  const range = value => value?.replaceAll("..", " – ");
  const phReasons = {
    ph_schedule_wages_required: "Confirm the employee’s statutory PH wage basis for the applicable compensation version.",
    ph_pay_profile_required: "Review PH pay treatment; verified statutory evidence is available under Advanced.",
    ph_occurrence_review_required: "Review this holiday’s work and eligibility.",
    ph_historical_wage_evidence_required: "Historical wage evidence required: confirm the missing preceding wage-period record once.",
    ph_eligibility_review_required: "Verify PH entitlement: statutory coverage, contractual hours, wage basis and holiday eligibility.",
    ph_eligibility_evidence_changed: "PH evidence changed. Review the current employment, time, pay and holiday evidence.",
    ph_preceding_wage_period_evidence_required: "PH pay needs verified qualifying wages and worked days from the preceding wage period with this employer.",
    ph_monthly_ordinary_wages_required: "Verify the ordinary monthly wage basis for PH pay.",
    ph_contract_hours_required: "Verify contractual normal daily hours for PH pay and overtime.",
    ph_normal_ot_boundary_requires_review: "Review approved PH normal hours and overtime against the contractual boundary.",
    ph_statutory_category_requires_review: "Verify the employee's applicable PH statutory category.",
    ph_part_time_contract_category_required: "Verify part-time category and comparable contractual working hours.",
    ph_part_time_partial_day_requires_review: "Partial part-time PH work needs a verified pricing rule.",
    ph_over_4000_contract_work_rule_required: "PH work pay requires verified contractual/category authority at this wage level.",
    ph_absence_or_substitution_requires_review: "Review holiday eligibility, adjacent absence and substitute-day evidence.",
    ph_company_overlap_review_required: "Verify whether the company PH benefit is additional to statutory pay or an inclusive top-up.",
    ph_company_treatment_confirmation_required: "Confirm the separate company PH benefit and its overlap with statutory pay.",
    ph_age_category_requires_review: "Verify age and applicable working-hours coverage for PH pay.",
    ph_territory_requires_review: "Verify the applicable territory's PH pricing authority.",
    ph_wage_period_requires_review: "PH pricing requires a supported monthly wage period.",
    ph_official_pack_required: "The applicable official PH formula pack requires review.",
  };
  if (phReasons[code]) return `${phReasons[code]}${detail ? ` · ${detail}` : ""}`;
  if (code === "pay_history_missing") return `Pay history missing · ${range(detail)}`;
  if (code === "employment_history_unresolved") return `Historical employment is unverified for ${range(detail)}.`;
  if (code === "component_proration_policy_required" || code === "component_multiple_amounts_requires_review") {
    const component = context.components?.find(c => c.id === detail);
    return `${component?.name || "Recurring component"} · ${code === "component_proration_policy_required" ? "Component proration policy required" : "Multiple amounts in one period require review"}`;
  }
  const coverage = context.statutory?.inputs?.applicability_coverage;
  if ((code === "statutory_applicability_missing" || code.endsWith("_applicability_unreviewed")) && coverage?.missing_through) {
    return `${code === "statutory_applicability_missing" ? "Statutory" : code.split("_")[0].toUpperCase()} applicability missing · ${coverage.start} – ${coverage.missing_through}`;
  }
  if (code.endsWith("_applicability_unreviewed")) {
    const scheme = code.split("_")[0].toUpperCase();
    const date = context.statutory?.inputs?.setup_effective_date;
    return `${scheme} applicability is not confirmed${date ? ` for the payroll period starting ${date}` : " for this payroll period"}. Open Payroll Profiles → Manage Statutory Setup and explicitly confirm the historical Effective Payroll Month; current setup does not establish earlier coverage.`;
  }
  if (code === "lindung_participation_unconfirmed") {
    const month = detail ? new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${detail}T00:00:00Z`)) : "This period's";
    return `${month} LINDUNG participation is unconfirmed. Open Manage Statutory Setup and confirm evidence for that contribution month.`;
  }
  if (code === "lindung_wage_treatment_unresolved") return `LINDUNG Act 4 wage treatment is unresolved for ${detail || "an earning component"}. Review the component's Act 4 wage treatment.`;
  const labels = {
    ph_payable_classification_requires_review: "Published paid-holiday work requires an explicit PH classification review; a Regular decision cannot bypass holiday entitlement.",
    ph_statutory_rule_unverified: `Public Holiday Allowance requires a verified Malaysia ${(detail || "employee").split(":")[0]} PH calculation rule, statutory eligibility, ordinary-day wage basis and normal contractual hours. Company Additional Pay does not resolve this.`,
    ph_ot_statutory_rule_unverified: `PH overtime requires a verified Malaysia ${(detail || "employee").split(":")[0]} PH-OT calculation rule and approved overtime beyond contractual normal hours.`,
    ph_paid_day_entitlement_unverified: "Hourly paid holiday without work requires verified holiday-pay eligibility and ordinary-day wage evidence; roster hours are not a holiday-pay formula.",
    lindung_designated_employer_missing: "Designated contributing employer is missing for LINDUNG.",
    lindung_designated_employer_mismatch: "LINDUNG designated employer does not match this Payroll employer. Review the designation evidence.",
    lindung_rate_pack_unavailable: "LINDUNG rate pack unavailable for this payroll period.",
    lindung_official_band_unavailable: "Official LINDUNG wage band unavailable; contribution has not been assumed.",
    lindung_june_mandatory_evidence_required: "June 2026 LINDUNG contributions are mandatory. Confirm June evidence; later opt-out does not cancel June.",
    lindung_employee_evidence_changed: "Employee nationality changed since LINDUNG confirmation. Reverify worker coverage evidence.",
    lindung_negative_wage_base: "LINDUNG contributable wages are negative; review earning and unpaid-time evidence.",
    employment_joined_date_missing: "Joined Date is missing; historical employment for this payroll period cannot be verified.",
    employment_assignment_requires_review: "Period employment assignment requires review",
    legal_employer_unresolved: "Legal Employer is unresolved for this period",
    mid_period_employment_change: "Employment assignment changes during this period; review employer and identity",
    missing_approved_payable_time: "Missing approved payable time",
    missing_punch: "Missing clock-in or clock-out; review payable time",
    pcb_confirmation_required: "PCB amount required",
    pcb_applicability_unreviewed: "PCB applicability requires review",
    epf_applicability_unreviewed: "EPF applicability requires review",
    socso_applicability_unreviewed: "SOCSO applicability requires review",
    eis_applicability_unreviewed: "EIS applicability requires review",
    ph_treatment_confirmation_required: "Review and confirm the company PH work treatment in Employee Review",
    ph_company_policy_required: "Confirm a company PH Work Policy in Public Holidays Settings",
    ph_treatment_evidence_changed: "PH work evidence changed; review and confirm its treatment again",
    ph_confirmed_work_evidence_required: "Confirm published PH work and approved payable time before pricing",
    public_holiday_ot_unsupported: "PH overtime is unsupported; a separate approved authority is required",
    replacement_leave_grant_required: "The source-linked Replacement Leave grant requires review",
    missing_effective_compensation_or_proration_policy: "Pay is not established for the full period; an approved proration policy is required.",
    partial_month_requires_approved_proration: "Partial-month pay requires an approved proration policy.",
    monthly_rate_change_requires_proration_policy: "The salary changed during this period; an approved proration policy is required.",
    monthly_calendar_rule_confirmation_required: "Confirm the official calendar-day Basic Salary rule in Pay Rules.",
    unpaid_half_day_policy_required: "Half-day Unpaid Leave requires an approved policy; no amount has been assumed.",
    unpaid_leave_overlap_requires_review: "Approved leave overlaps; resolve the source leave evidence.",
    unpaid_leave_attendance_conflict: "Attendance conflicts with approved Unpaid Leave; review the source evidence.",
    monthly_proration_jurisdiction_requires_review: "Verified Peninsular Malaysia / Labuan Employment Jurisdiction for this payroll period is required before Monthly unpaid-time pay can be calculated. Resolve the dated People employment evidence.",
    monthly_proration_jurisdiction_change: "Workplace jurisdiction changes during the period; review its salary treatment.",
    monthly_components_entitlement_policy_required: "Recurring components in an incomplete month require an approved entitlement policy.",
    mid_period_component_change: "A recurring component changes during this period; its period treatment requires review.",
    statutory_applicability_missing: "Statutory applicability is not established for the employee's eligible period.",
    mid_period_statutory_applicability_change: "Statutory applicability changes within this period and requires review.",
    mid_period_statutory_input_change: "Contribution categories change within this period and require review.",
    phase3_calculation_missing_or_stale: "Refresh payroll after resolving employee inputs.",
    earnings_inputs_require_review: "Resolve the earning inputs above before calculating statutory amounts.",
    employment_start_date_requires_review: "Confirm the employee's commencement date in Employee setup.",
    unreconciled_time: "Refresh payable time evidence",
    unresolved_time_exception: "Resolve the payable time exception",
    stale_time_evidence: "Work evidence changed; refresh payable time",
    missing_payroll_profile: "Set up this employee's pay before calculating payroll.",
  };
  const text = labels[code] || code.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return /^\d{4}-\d{2}-\d{2}$/.test(detail || "") ? `${text} · ${detail}` : text;
}


// Scheme cells consume persisted contribution lines and period-resolved setup.
// Overall totals stay unavailable until every required component is ready.
export function payrollStatutoryCell(row, scheme) {
  const setup = row.preparation?.statutory_setup?.schemes?.[scheme];
  const line = row.statutory?.lines?.find(item => item.scheme === scheme);
  if (!setup || !['confirmed', 'not_applicable'].includes(setup.state)) return { state: 'Review' };
  if (setup.applicable === false) return { state: 'N/A' };
  if (scheme === 'pcb' && !row.pcb?.confirmation) return { state: 'Review' };
  if (!row.result.earningsCurrent || !row.statutory || row.statutory.is_stale) return { state: 'Pending' };
  if ((row.statutory.issues || []).some(issue => String(issue).startsWith(`${scheme}_`) || issue === 'statutory_applicability_missing')) return { state: 'Review' };
  if (!line || line.employee_amount == null || (scheme !== 'pcb' && line.employer_amount == null)) return { state: 'Pending' };
  return { state: 'calculated', employee: line.employee_amount, employer: scheme === 'pcb' ? null : line.employer_amount };
}
