# Payroll Phase 5 canonical Staging closure

Implementation: `98a3373dcf37e4eef6a2fc53cf94d1a231a47cdf`.
Staging Supabase: `ujkzdaaadnvcfayuldmh`; canonical Git Integration dev deployment
`dpl_4nH66Nf8TaG4zDWfnT4ofBn7pdH6` READY. No Production or main action.

## Approved isolated fixtures and expected results

Legal Entity `QA-P5-20260927`, outlet `QA-P5-0927`, no Admin-login employees
`QA-P5-1` / `QA-P5-2`. Source creation is fixture setup, not financial authority.
Monthly basic RM3,250 with supported automatic EPF/SOCSO/EIS and synthetic
confirmed PCB RM50: Gross RM3,250, deductions RM431.75, Net RM2,818.25.
Hourly five approved regular hours at RM15: Gross RM75, deductions RM9.60,
Net RM65.40; PCB N/A. Both passed canonical Calculate → Ready → Finalize.

Original Run `d725c8a6-c117-4843-8162-273048cfee2a`.
Correction `e9d2142f-d69d-406e-921b-1db95edc5942`, separate canonical earning
RM100 and explicitly confirmed PCB RM55: Monthly Gross RM3,350, deductions
RM448.45, Net RM2,901.55, employer cost RM3,852.35. Settlement delta RM83.30.
Original finalized statutory snapshot hash was asserted unchanged during
correction and after a later October compensation change and retirement.

## Persisted authenticated UI / security

- Admin finalized Monthly and Hourly record → View Payslip generated private
  immutable A4 PDFs. Locally rendered production-renderer bytes matched actual
  Staging artifact hashes for both originals. Layout visually inspected.
- Renderer deterministic retries, Chinese text and multi-page wrapping passed.
- Disposable Monthly Crew Me → Payslips showed one June result RM2,818.25;
  refresh after correction showed only RM2,901.55 and a different private PDF.
  Separate Hourly Crew showed only RM65.40 and its own current PDF. Dark mobile
  390px list and normal Admin detail inspected. No payslip runtime errors.
- Existing unrelated Crew Me `myLeave`/`assetsMobile` errors on incomplete
  disposable employee context were observed; no changes made to those owners.
- Token-bound cross-period denial, invalid/revoked token denial, unsigned Admin
  denial, direct-table privilege denial, exact request retry and changed-payload
  rejection passed rollback security assertions. Period lock and current-pointer
  authority reject new settlements against superseded revisions.
- Admin UI recorded synthetic payment RM1,000 → Partially Paid; RM1,818.25 →
  Paid. Correction preserved settled RM2,818.25 and showed RM83.30 outstanding.
  Synthetic RM93.30 additional evidence → Recovery Required RM10; recovery RM10
  → Paid, zero outstanding/overpaid. These entries record no real transfer.
- Four immutable PDFs / four generation events; four settlement entries / four
  payment audit events; two finalized revisions. Historical PDFs remain retained.

## Cleanup and compatibility

Both disposable Crew Access states Disabled, zero active sessions; live Hourly
session returned to sign-in after revocation/refresh. Employees, outlet, entity
and QA component retired. Published roster/Attendance, final payroll, all PDF
artifacts and append-only settlement/audit evidence intentionally retained.
No real employee, source evidence, Production or financial-transfer mutation.

Pre-Phase-5 finalized revisions lacking frozen employer/employee identity are
truthfully unavailable for PDF generation, not regenerated from mutable identity.
Historical financial snapshots remain readable. Any later historical identity
remediation requires a separately verified owning-authority decision.

Focused UI/security contract tests (6) and routing contracts (10), client build
and diff check passed. Documentation Impact: updated `docs/domains/payroll.md`.
Payslip privacy/presentation used the PDF and existing FeedX shared UI patterns;
there is one renderer, no Legal Contract/document ownership reuse.

PAYROLL PHASE 5 = PASS
