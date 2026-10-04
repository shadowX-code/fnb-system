# Reusable PH Pay Profile — Staging verification

Verified 4 October 2026. Implementation commits: `66ac4e63` and `9faacc29`.
Environment: canonical Staging `ujkzdaaadnvcfayuldmh`; authenticated owner browser on `fnb-system-staging.vercel.app`. No Production mutation or deployment.

## Authority and migration scope

- `20261004020904_payroll_ph_pay_profile.sql`: append-only effective profiles, source-bound reusable historical wages, canonical wage derivation, occurrence-only confirmation and automatic recalculation.
- `20261004025632_payroll_ph_profile_contract_boundary.sql`: completed uploaded contracts invalidate later reusable profile evidence; superseded completed contracts continue to resolve their historical dates.
- Each linked Staging runner dry-run selected exactly its sole pending migration before execution. Existing statutory PH pricing function is unchanged: MD5 `7f8790fb936cb447c529788139631993`.

## Contracts and build

- 20 focused UI/workflow tests pass; production build passes (existing chunk-size warning).
- `payrollPhProfile.rollback.sql` passes on local rehearsal and Staging. Synthetic full-time monthly, full-time hourly and verified regular part-time hourly profiles reuse one revision across two PH dates. Pre-effective dates remain unverified; genuine later employment changes invalidate only the later basis.
- Canonical preceding Payroll derives RM40 regular wages and one worked day. Source changes invalidate previously confirmed manual historical evidence. One explicit historical month confirmation is reused across holiday dates.
- Explicit roster approval and correction append existing payable-time history; original time evidence remains unchanged. PH/OT earnings reconcile with aggregate Gross. Absence/substitution remain independent blockers.
- Unknown actors, private helper access, evidence override payloads, append-only changes and mismatched retries fail closed.
- Disposable local finalized-state fixtures reject profile, wage and occurrence mutations. Historical completed/superseded/uploaded contract fixtures verify dated basis invalidation. These additional fixtures were rolled back, without modifying Staging finalized evidence.

## Authenticated Staging runtime

Labelled `QA ONLY PH Profile` employer, two employees and February 2027 Draft only. Reused the existing published synthetic 2027 calendar; no real calendar publication or modification.

- Monthly profile saved once and returned to the same day review; all five PH dates resolve that profile. Paid Holiday / Did Not Work creates no duplicate monthly basic payment.
- Regular part-time profile saved once. Missing January 2027 wages used one reusable historical setup; all February PH dates then resolve the same evidence.
- On the final implementation `9faacc29`, confirming the second hourly holiday automatically changed Public Holiday Allowance from RM80 to RM160 (two ordinary days × RM80). Remaining independent PH and LINDUNG blockers stayed unresolved.
- Third-day occurrence dialog displays the published holiday, verified profile/wages, roster, attendance, approved time and leave. No repeated First Schedule, contractual-hours, comparison or wage questions. No manual adjustment is offered without a real time record.
- Screenshot: `/private/tmp/payroll-ph-profile-staging.png`.

## Preservation and fixture retirement

Existing legacy occurrence reviews were not promoted into profile evidence. Frozen calculation snapshot hash remains `4ffd823dc9899816bee4ccdc7308de83` before and after verification.

Synthetic employer `ab4a7512-8da5-425f-9edd-01d06b8c0d67` and outlet `5e452dd6-5d3f-47d9-a933-ffc18e3fab1a` were made inactive after verification. Two profile revisions, one historical wage revision, three occurrence decisions, compensation/employment and Draft evidence remain retained. No evidence deletion or employment reactivation.

Missing or unsupported employee coverage, historical wages, substitution and absence/forfeiture facts remain Review Required. Company Additional Pay remains separate and the original statutory pricing authority continues to reject unresolved overlap.

Documentation impact: Updated (`docs/domains/payroll.md` and development milestone log).
