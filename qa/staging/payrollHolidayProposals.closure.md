# Official Holiday Proposals — L3 verification

## Production forensic (read-only)

The 2026 HKA annual PDF, annual Gazette and conditional supplement were all captured (`fetched`), with zero candidate rows and no parser version. No 2026 calendar existed. The checker intentionally stopped at capture; `payroll_holiday_candidate_parse` accepted Admin transcription only. The ledger remained 609 and these source hashes/statuses/zero-row projections were unchanged after this task. No Production change was made.

## Canonical ownership

The trusted `payroll-holiday-updates` checker extracts into existing candidates through a service-only proposal command. Existing authenticated review, annual publication, additional-entitlement and company-policy authorities remain separate. Source PDF/hash and append-only extraction/review evidence are retained. No automatically published calendar or company-policy mutation occurs.

## Verified

- Official HKA 2026: 49 combined-table rows → 101 dated jurisdiction entries. The independently parsed rotated annual Gazette corroborates dates/names/jurisdictions. Pinned source hash supports HKA's image state headings; changed unknown layouts fail closed.
- Official dates marked subject to change require review. PUB-111/2026's conditional alternatives remain blocked (26 jurisdiction entries); neither alternative is chosen automatically. A supplementary Gazette cannot replace an annual calendar.
- PDF text fragments are joined before weekday validation; real Staging extraction has no false weekday warnings.
- 34 focused parser/discovery/UI tests passed; integrated build passed (existing chunk-size advisory only).
- Existing controlled-import rollback contracts passed. New rollback contracts passed for source-hash rejection, service-only grants, clean-row pre-review, blocked approval, idempotent proposal retry, correction/audit preservation, explicit publication, published-source immutability, same-name date conflicts and unchanged finalized snapshots.
- Authenticated canonical Staging Check Official Updates fetched and generated proposals. A single reviewed Negeri Sembilan classification saved/read back with server-derived actor and `review_saved` evidence; it disappeared from the exception queue. Remaining uncertainty blocked annual approval. Correction UI exposed only the uncertain rows while retaining clean rows.
- Existing published calendars/company selections were not republished or advanced. Staging statutory snapshot hash remained `6c830532cc9f11c406b0e0648228f2db` across runtime QA.

## Remaining operational review

Source rows flagged provisional and conditional alternatives require actual official observed-date evidence and Admin review. Unsupported future official PDF layouts retain a specific manual-review fallback. No claim of unattended legal classification or full-year statutory compliance is made.

Official source basis:
- https://www.kabinet.gov.my/hari-kelepasan-am/
- https://www.kabinet.gov.my/akta-dan-warta/
- https://jtksm.mohr.gov.my/en/borang/employment-act-1955
