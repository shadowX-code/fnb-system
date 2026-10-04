# PH Pay Treatment — Staging verification

Verified 4 October 2026. Application implementation: `12bbd3e1dd1a2c832ca9eb678ba0ff0b0b65b8d7`; canonical Staging only (`ujkzdaaadnvcfayuldmh`). Documentation impact: Updated Payroll domain and milestone log. No Production changes or deployment.

## Authority and scope

- Sole migration `20261004033322_payroll_ph_occurrence_pay_treatment.sql` was selected by the linked Staging dry-run and applied. Ledger: 634.
- Existing statutory pricing engine remains unchanged: MD5 `7f8790fb936cb447c529788139631993`.
- Statutory treatment requires a determinate canonical quote. Custom/zero treatments are explicit audited overrides, require reason and warning acknowledgement, and do not manufacture statutory compliance evidence.
- Quote fingerprints reject stale confirmation; unknown actors/private helper access fail closed. Published-calendar, authorized outlet/run scope, approved-time, independent company-benefit and finalized-state gates remain enforced.

## Contracts/build/Payslips

- Production build and 15 focused UI/workflow tests pass.
- `payrollPhTreatment.rollback.sql` passes locally and on Staging. Full-time monthly/hourly and verified regular part-time fixtures cover determinate statutory quotes, missing evidence/custom, zero/warnings, correction history, separate PH overtime, company benefit off/inclusive top-up/additional, exact Gross, stale quote and authorization rejection. All contract mutations roll back.
- Custom normal RM50 and PH OT RM17 remain separate canonical earning codes; inclusive RM64 company benefit adds only RM14, while genuinely additional benefit remains separately labelled.
- Actual canonical calculations feed `payrollPhTreatment.render.mjs`: three monthly/hourly/part-time Draft/Final pairs pass exact Gross and aggregation parity through the existing Unicode PDF renderer. No Edge function/font deployment is required.
- Disposable local frozen fixtures reject treatment writes; existing Staging finalized snapshot hash remains `4ffd823dc9899816bee4ccdc7308de83`.

## Authenticated browser verification

READY Staging deployment `dpl_3AEAqwwenvGcxmqDowVsGU3syXpw` served implementation `12bbd3e1`.

- Labelled synthetic employee without any PH Pay Profile confirmed Custom RM125.50, corrected it to RM150.00, and confirmed No Additional PH Pay on another date. Both custom revisions remain stored, actor/reason/time/warnings retained; profile count remains zero.
- Existing verified regular part-time fixture previewed/confirmed statutory RM80 for another holiday without repeating reusable profile setup.
- Monthly fixture previewed statutory RM0 for an unworked holiday with explicit Basic Salary inclusion copy; saved row reads Confirmed.
- Normal dialog shows three treatments, contextual day facts, server comparison, reason and relevant warning acknowledgement. Profile/wage tooling is collapsed under Advanced compliance. Screenshot: `/private/tmp/payroll-ph-treatment-staging.png`.
- Reused only the already published synthetic February 2027 calendar. No real holiday calendar was published or altered.

## Fixture retention

Synthetic employer `ab4a7512-8da5-425f-9edd-01d06b8c0d67` and outlet `5e452dd6-5d3f-47d9-a933-ffc18e3fab1a` were returned to inactive after verification. Employment, compensation, approved-time, PH treatment/correction and audit evidence are retained. No evidence deletion or real employee mutation.

Independent statutory/readiness issues still require their own evidence. Custom/zero PH treatment resolves the occurrence amount while preserving missing statutory facts and compliance warnings; it is not certification of legal entitlement compliance.
