# Public Holiday operational UX — verification in progress

Documentation Impact: required, narrow Payroll owner updated. L3: forward-only
import/publication/read adapters; no PH financial/Leave lifecycle change.

## Completed

- Focused UI tests, build and diff check passed for the initial operational release.
- Canonical Staging Git deployment: `ae9c11c97edacb82f61cb70bd59c416284c88f28`,
  `dpl_7pCFTk4NK9PqzZck3mXzVypTsp2U` READY with canonical alias.
- Authenticated Owner Settings → Public Holidays: simplified Calendar/Company
  Policy, source-empty Setup Required, no retired synthetic calendar in active
  view, publication disabled without source, import modal and PH benefit summary.
- Rollback-only server test: reviewed import, manifest SHA-256/audit, retry,
  changed-intent rejection, required lock, shared active-company scope, source
  update leaves assignments unchanged, retirement guard/history, canonical PH
  benefit delegation, anonymous denial. Every test write rolled back.
- Explicitly retired the three already-retired synthetic calendar versions via
  the canonical retirement command; associated companies were inactive.
- Retained finalized QA run `7adc00ce-9f58-43d8-b587-9fd17e7a27af` remained
  Finalized with unchanged row hash `a76713f28b0914575e58d4ec99d02649`.

## Outstanding gates / truthful boundaries

- Requested approval for one isolated Staging calendar fixture for authenticated
  persisted import/review/publication. No new fixture has been persisted yet.
- Shared publication/exception collisions remain governed by the existing frozen
  scope authority. Existing company policies are never silently reassigned.
- Browser viewport override did not establish the requested 1024 CSS width;
  observed width was 1365 with no document overflow. Do not claim narrower QA.
- Reviewed structured import is implemented; unattended official ingestion is
  BLOCKED. Required external input: independently reviewed JPM annual calendar
  plus applicable special/substitute gazettes, or a verified maintained structured
  provider contract. No official dates/classification are inferred from names.
- Authenticated persisted publication and selected-state table QA still required
  before an operational UX PASS claim. Financial/Leave source owners unchanged;
  existing calculation closure was not repeated.
