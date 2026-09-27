# Phase 5 V1 closure — canonical Staging

Payment/settlement client controls and execute grants removed; existing history retained.
One renderer serves transient Admin Draft and immutable private Final PDFs.

## Persisted isolated fixture

- QA-P5V1-20260927 Legal Entity/outlet; Monthly RM3,250 and Hourly RM15 × 5 approved hours, June 2026.
- Original Monthly after RM100 allowance: Gross RM3,350; employee statutory RM443.45 including confirmed PCB RM50; Net RM2,906.55.
- Correction Monthly with RM200 allowance and independently confirmed PCB RM55: Gross RM3,450; deductions RM460.15; Net RM2,989.85.
- Hourly Gross RM75; Net RM65.40. Correction run Net RM3,055.25.
- Authenticated Admin Draft preview, original Finalize and final PDF actions passed. Correction draft and final actions passed; original snapshot unchanged.
- Four immutable artifacts and exactly four generation events retained across two finalized revisions. Draft preview created no artifact/job.
- Fresh token-bound Crew checks: own current period only, cross-employee denial, original remains current during correction Draft, corrected Final replaces employee-visible selection, revoked-session denial. Prior Crew browser coverage reused; fresh Crew browser sign-in was not repeated.
- No settlement records created.

## Cleanup / focused verification

Both disposable Crew accounts Disabled, zero active sessions. Employee, outlet, Legal Entity and allowance retired. Published source evidence, finalized revisions, PDFs and audit history retained as QA history.
21 focused tests and production build passed. Monthly/Hourly/Draft A4 render inspected; Unicode/long-line pagination and deterministic PDF bytes verified. Full TrueType embedding fixes the existing invalid CJK subset; private maximum 16 MiB, historical artifacts never overwritten.
No Production deployment or main merge. Payroll calculation and finalized source authorities unchanged.
