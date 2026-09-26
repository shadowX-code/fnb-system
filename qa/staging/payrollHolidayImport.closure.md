# Official Holiday Controlled Import V1 — Staging closure

QA level: L3. Staging only (`ujkzdaaadnvcfayuldmh` / canonical
`fnb-system-staging.vercel.app`). No Production deployment or mutation.

## Boundary

Admin uploads the exact official PDF plus a verified structured transcription.
There is no unattended fetch, PDF extraction, sync or publication. Government
HTTPS reference validation does not certify PDF content; human source review is
explicit. Private bounded PDF bytes and server SHA-256 are retained behind the
existing shared Payroll holiday authorization, not public Storage URLs.

## Verification

- 98 relevant Payroll/People regression tests passed before the focused summary
  correction; the final focused Annual Calendar/import suite passed 15 tests.
- Production build passed (existing bundle-size warnings); `git diff --check`
  passed.
- `payrollHolidayCandidates.rollback.sql` passed on Staging: exact capture retry,
  changed-payload rejection, server artifact hash, unofficial URL rejection,
  National/Perak/Selangor normalization, no required-paid inference, all diff
  states, revision-stale rejection, missing entry retention, blocked approval,
  publish retry and private/anonymous access denial. All those fixtures rolled
  back.
- Authenticated Owner UI: labelled QA source → verified transcription → three
  new exceptions → explicit verification/complete-source approval → canonical
  Annual Calendar publication. Refresh restored the result and source/history.
- A newer import matched all three entries; no repetitive row checkboxes were
  required. Explicit approval/publication created a separate annual version.
- Source download action/read succeeded without runtime errors. Node's independent
  SHA-256 matched server evidence:
  `6abadcb9671da28e9ff46e981e673d8840e0f4ffee7adb0b09aefa8967283f85`.
- Publication retry returned the same calendar with exactly one publication event
  per candidate. Source capture also retained exactly one event.
- An isolated inactive QA Legal Entity's Company Paid Holiday policy remained
  assigned to the first calendar after the newer source was published. No default
  company assignment, Payroll, Leave or PH Work command was invoked.
- QA found accepted exceptions still counted as pending review. The focused
  presentation fix and tests passed; authenticated refresh showed zero pending
  review for both published candidates. No lifecycle change was needed.

## Retained isolated evidence / cleanup

All names/references explicitly use `QA ONLY`; dates are synthetic, not official.
Fixture capture/setup used canonical server commands; transcription, review,
approval and publication were exercised through the authenticated UI.

- Candidates (retired): `95c1f3c2-604c-492f-8436-7c634c5d3af6`,
  `7a41ce5d-935d-4517-9e75-2911165e44df`.
- Calendars (retired with append-only events):
  `fda9f878-38bc-4f85-8407-5fea356eebea`,
  `7474ef06-b0d0-4403-b870-00f3cb134a28`.
- QA Legal Entity (created inactive):
  `a3dcafa6-2a50-47b7-8a75-558009470f1e`.
- Immutable QA policy `f8725ffc-9f13-473b-9368-5e7680e12e1c` remains pinned to
  the first calendar for that inactive company only.
- Cleanup reads: zero operational candidates, zero QA authoring candidates,
  zero operational 2027 calendars. Private source bytes, published holiday
  definitions, calendar/policy snapshots and audit history are intentionally
  retained, not deleted.
- No existing QA employee, source shift, Payroll result or immutable PH evidence
  was modified.

## Security review

The new tables deliberately deny all client table access (RLS plus revoked
grants); authorized SECURITY DEFINER wrappers validate the existing Owner/Admin
shared-holiday authority. Advisor notices for
[RPC-only RLS tables](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
and [intentional authenticated trusted commands](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
were reviewed; no public execute/direct access was introduced.

Applied migration versions are aligned to Staging history:
`20260926171247` and `20260926171442`. Source code is unchanged by filename
alignment; corrections remain forward-only.

OFFICIAL HOLIDAY CONTROLLED IMPORT = PASS

AUTOMATED OFFICIAL IMPORT = NOT ENABLED
