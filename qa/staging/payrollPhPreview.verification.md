# PH Pay Treatment financial preview — Staging verification

Verified 4 October 2026 at L3 on canonical Staging (`ujkzdaaadnvcfayuldmh`). Implementation `fe2a96392802b7b9bf96a28b10604f3fd874aea9`, READY deployment `dpl_3rY2dkPnA2zsBBqyKU8HDNfx7EjE`. Documentation Impact: Updated Payroll domain and development log. Production unchanged.

## Authority

- Sole forward migration `20261004073447_payroll_ph_treatment_financial_preview.sql` selected by the linked Staging dry-run and applied; ledger 637.
- Read-only preview sums the exact canonical earning lines consumed by Payroll. No client-side pricing. Monthly Basic Salary remains period earnings; no invented day allocation or duplicate hourly PH Regular Pay.
- Preview displays the day total and net change versus the effective prior day contribution. Quote binds the prior review revision, preventing a concurrent correction from invalidating the shown financial effect silently.
- Existing pricing function MD5 remains `7f8790fb936cb447c529788139631993`. Finalized snapshot hash remains `4ffd823dc9899816bee4ccdc7308de83`.
- Public preview requires authenticated Payroll view/run/employee scope; private quote remains inaccessible to authenticated/anonymous callers. Existing mutation, reason, compliance acknowledgement, immutable and outlet guards preserved.

## Contracts and presentation

- Build and 19 focused tests across four workflow/component files PASS.
- Expanded rollback contract passes locally and on Staging: statutory available/unavailable, monthly/hourly/regular part-time, custom/zero, PH OT, configured/unconfigured company benefit and inclusive/additional ownership, audited correction, authorization, stale/concurrent quote rejection and idempotent retry.
- Every determinate contract preview reconciles exactly with saved canonical Gross delta. Preview creates no audit mutations.
- Three actual canonical calculation fixtures render six Draft/Final PDFs through the existing Unicode renderer: exact Gross, compatible aggregation and Draft/Final parity PASS. Daily and separate PH OT evidence retained.
- UI tests include immediate input invalidation, asynchronous response ordering, failure states, approved-time correction controls and finalized read-only behavior. Confirmation cannot use a stale preview.

## Authenticated browser

- Synthetic missing-profile employee: Custom correction RM150.00 → RM160.25 displayed day earnings RM160.25 and Payroll increase RM10.25. Saved effective earnings RM160.25; revision 3 preserves prior decisions and statutory warnings.
- No Additional PH Pay displays Public Holiday Allowance RM0.00/day total RM0.00 with acknowledgement and reason still required. Statutory unavailable text and both recovery actions visible; Advanced compliance remains collapsed, unconfigured company control omitted.
- Verified hourly employee: statutory preview RM80.00, explicit day confirmation saves and aggregated earnings change RM240.00 → RM320.00.
- Screenshots: `/private/tmp/ph-preview-correction.png`, `/private/tmp/ph-preview-statutory.png`.
- Browser used only previously labelled synthetic February 2027 fixtures. No real holiday calendar or employee facts modified. Synthetic employer/outlet restored inactive; all QA audit evidence retained.

No remaining implementation blocker. Production delivery requires separate release authorization.
