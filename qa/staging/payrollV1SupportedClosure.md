# Payroll Phase 4 V1 supported-envelope closure

Staging only, approved isolated no-access fixture `QA-P4-V1-0927`.
No Production, payment, payslip or finance action.

## Canonical persisted evidence

June 2026, Malaysian DOB 1990-01-01, Monthly RM3,250 effective Jan 1.
EPF Part A October 2025; Act 4 First Category and Act 800 Standard,
October 2024 PERKESO schedules. All schemes applicable; PCB manual confirmed.
Fixture masters were SQL test setup; Payroll mutations used canonical commands
under the existing real Owner's permission context, not direct Payroll writes.

| Evidence | Original revision | Current correction |
|---|---:|---:|
| Gross | 3250.00 | 3350.00 |
| Employee EPF | 359.00 | 370.00 |
| Employee SOCSO | 16.25 | 16.75 |
| Employee EIS | 6.50 | 6.70 |
| Confirmed synthetic PCB | 50.00 | 55.00 |
| Net Pay | 2818.25 | 2901.55 |
| Employer EPF | 424.00 | 437.00 |
| Employer SOCSO | 56.85 | 58.65 |
| Employer EIS | 6.50 | 6.70 |
| Employer Cost | 3737.35 | 3852.35 |

Original `e953dc43-6462-4ca7-8076-54358c06058e` retains statutory hash
`511d5a55e8d673b2ccfd65468bfced38`. Current correction
`bf07f03c-a93e-479c-8999-8c37703f047e` retains hash
`3947d65cda1992fe7fdebbe8ef3f7be4`. Net settlement difference is +RM83.30.

Permanent historical salary mutation correctly rejected. The correction used
a separate canonical RM100 earning adjustment, not salary history overwrite.
Its own PCB confirmation was required. Missing PCB blocked Net/Ready; retry
returned the same original PCB ID. Each run has one Finalize event and frozen
profile/calculation/statutory snapshots. Later August pay setup left snapshots
unchanged. Period pointer selects correction; original stays Admin-visible.

Authenticated Payroll UI verified both frozen statements, categories, contributions,
Net and Employer Cost. No runtime errors. Monthly has no required time records;
no roster/Attendance evidence was invented or changed.

The forward migration restores fractional EPF residual fail-closed behavior;
ordinary official bands remain Ready. A legacy RM21,250 projection now reports
`epf_remittance_rounding_allocation_unapproved` with no proposed Net Pay, without
rewriting its old finalized evidence. Unsupported nationality/category, age and
bonus classification gates remain intact; no automatic PCB was built.

Cleanup: fixture Employee no-access/inactive, Legal Entity and Outlet inactive,
QA correction component unavailable. Immutable Payroll/audit evidence intentionally
retained as labelled QA history. No existing employee/source records changed.
