// Recruitment explanations only. Never Payroll calculations or negotiated terms.
export type Offering = Record<string, string | number | boolean> & {
  id: string;
  employment_type: string;
};
export function hourlyExplanation(offer: Offering, workedHours: number) {
  if (
    offer.compensation_type !== "hourly" ||
    typeof offer.amount_min !== "number" ||
    (offer.amount_max !== undefined && offer.amount_max !== offer.amount_min) ||
    !offer.currency ||
    !Number.isFinite(workedHours) ||
    workedHours <= 0 ||
    workedHours > 16 ||
    !Number.isInteger(workedHours * 2) ||
    typeof offer.break_threshold_hours !== "number" ||
    typeof offer.break_minutes !== "number" ||
    typeof offer.break_paid !== "boolean"
  )
    return null;
  const breakMinutes =
    workedHours >= offer.break_threshold_hours ? offer.break_minutes : 0;
  const paidMinutes =
    Math.round(workedHours * 60) - (offer.break_paid ? 0 : breakMinutes);
  if (paidMinutes < 0) return null;
  const amountMinor = Math.round(
    (paidMinutes * Math.round(offer.amount_min * 100)) / 60,
  );
  return {
    worked_hours: workedHours,
    break_minutes: breakMinutes,
    paid_hours: paidMinutes / 60,
    currency: offer.currency,
    amount: amountMinor / 100,
  };
}
export function offeringContext(
  offers: Offering[] = [],
  jobContext: Record<string, unknown> = {},
) {
  if (!offers.length && !Object.keys(jobContext).length) return "";
  return `Confirmed shared job / workplace context (opening facts, not master data): ${JSON.stringify(jobContext)}.
Confirmed Employment Offerings (immutable opening configuration): ${JSON.stringify(offers)}.
When there are multiple offerings, naturally establish the candidate's employment preference, preserving both if open to both. Use relevant offering facts and tailor availability to that arrangement; reuse established evidence. Employment preference is not performance, fit or a new Evidence Area. Candidate questions may concern either offering. Never combine terms from different offerings.
Compensation is explanatory only: never assign, negotiate or promise a final salary; a range's final amount must be confirmed by the hiring Supervisor. Never interpret statutory compliance from supplied recruitment terms. Blank/absent terms, OT policy/calculation, unspecified increment amounts and leave entitlements are UNCONFIRMED; say so without inventing terms.
Deterministic ordinary-rate hourly lookup (half-hour increments, >0 to 16 worked hours; no OT or public-holiday calculations): ${JSON.stringify(offers.filter((o) => o.compensation_type === "hourly").map((o) => ({ offering_id: o.id, results: Array.from({ length: 32 }, (_, i) => hourlyExplanation(o, (i + 1) / 2)).filter(Boolean) })))}.
For supported pay examples, read the matching lookup result only. Never perform free-form arithmetic, interpolate, extrapolate or calculate holiday/OT pay. If no matching result exists, tell the candidate that the calculation needs Supervisor confirmation. Configured double pay may be explained as a fact, never calculated here.`;
}
