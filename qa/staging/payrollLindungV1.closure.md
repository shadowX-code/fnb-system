# Payroll LINDUNG 24 Jam V1 — Staging closure

Scope: independent Payroll statutory participation authority, official Phase 1 pack, setup/readiness/review, shared Draft/Final payslip renderer. Production was not accessed or mutated.

## Regulatory fixture

- [PERKESO official Phase 1 contribution schedule](https://www.perkeso.gov.my/images/lindung/lindung-24-jam/NewContributionRateIncludingSKBBK.pdf).
- [PERKESO LINDUNG FAQ](https://www.perkeso.gov.my/images/lindung/lindung-24-jam/130826-FAQ%20_LINDUNG24Jam_EN_version.pdf).
- All 65 employee sen amounts independently compared with the official PDF; every lower/upper boundary and RM6,000 ceiling tested. Employer amount is zero. No percentage approximation or future-phase table.

## Installed authority

Canonical Staging: `ujkzdaaadnvcfayuldmh` (`fnb-system-staging`).
Migration: `20261003061649_payroll_lindung24jam_v1.sql`.
The file was created with the installed Supabase migration CLI at `20261003054511`; after MCP application its filename was aligned with the assigned Staging ledger version. SQL content was unchanged.

`payrollLindungV1.rollback.sql` passed all 13 runtime groups against the installed migration: June mandatory; local opt-out/rejoin; foreign mandatory; designated/missing employer; unresolved historical month; rate-pack absence; independent Act 4 wage policy; retry/stale/audit; authority denial; Review/Draft; Final freeze; governed correction; existing evidence preservation. Fixtures and commands were rolled back. No real employee setup was changed.

The existing People Payroll period cutover gate still rejects periods beginning before 29 September. Financial finalization tests use a transaction-local wrapper for the synthetic QA employer only; the original function is delegated for every other employer and restored by rollback. This is explicitly absent from the delivered migration. LINDUNG does not bypass the People employment authority.

- Existing finalized statutory snapshots: **15**.
- Before/after result hash: **5999e593aa3a5d9beacfe458d8525d0f**.
- Persisted LINDUNG participation rows after migration and rollback QA: **0** (no backfill).
- Existing September members therefore require explicit September participation evidence.
- Focused UI/contracts: **43 tests passed** across seven files; production build passed (existing bundle-size warning).
- Actual Staging Draft/Final fixture manifests rendered through the shared PDF implementation: separate employee LINDUNG line, no employer line, Unicode, parseable PDF and deterministic retry bytes passed.
- Only `payroll-payslips` Edge function deployed to Staging.

Documentation Impact: Updated `docs/domains/payroll.md` and the development log.
