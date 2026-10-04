# Payable Time Save & Next latency — Staging closure

2026-10-04. L3 targeted verification. Implementation commit:
`305eeaa3752389dd48896b0e22631761e3f712c2`.

## Production forensic (read-only)

Phoenix Wong Kar Yan, September 2026: Production PostgreSQL logs at
14:06:17.830, 14:09:22.479 and 14:10:16.787 UTC identify
`payroll_time_decision_save(jsonb)` cancellations. The adapter called
`payroll_employee_recalculate` inside the decision transaction; calculation
traversed the monthly PH/profile/wage projections and run locking. Post-save UI
then waited for whole-run calculation/statutory/preparation reads and month time
read-back. Other logged projection cancellations could therefore report an error
after a decision had already committed. Bound request payloads were unavailable
in those logs; no individual canceled date is asserted.

Read-only EXPLAIN ANALYZE measured Phoenix's monthly calculation projection at
5,220.882 ms (12,574 shared hits), and a cold single-day time-evidence read at
1,019.537 ms (2,913 shared hits), with zero dirtied/written blocks. The global
SECURITY DEFINER effective-compensation function prevented profile predicate
pushdown. Existing profile/date/revision indexes support equivalent directly
filtered latest-version reads; no new index was needed. All profiles and September
dates compared on Staging produced zero effective-compensation mismatches.

## Delivered authority/workflow

Migration `20261004141741_payroll_payable_time_fast_decision.sql` applied only to
Staging; linked CLI dry-run selected only that version. Staging ledger: 640.

Time decision + audit commit together, returning the canonical saved day/history.
The changed time identity invalidates the existing calculation fingerprint.
Sequential review patches its queue without month financial/time rereads. It
suspends whole-run refresh while reviewing and coalesces automatic employee
recalculation on finish/explicit return, before refreshed financial projections.
Stale monetary values are unavailable; Employee Review shows Updating calculation.
Existing Retry Calculation remains failure recovery only.

SQL cancellation rolls back the decision transaction. A lost transport response
uses actor/payload-bound request read-back and identical replay; ambiguous outcomes
freeze the intent for Verify / Retry Decision. A projection failure cannot submit
another decision. Run/day locks, unique request evidence, current-source/latest
version checks, authorization and finalized gates remain enforced.

## Verification results

- 37 focused UI/hook/service tests and production build passed.
- Isolated local 22-save SQL contract: mean 3.33 ms, maximum 4.96 ms.
- Staging rolled-back 22-save SQL contract: min 33.30 ms, mean 34.05 ms,
  maximum 36.75 ms. No month calculation revision during the save loop.
- Cancellation after append (57014) rolled back the time/audit; identical retry
  appended once. Lost-response lookup/replay and altered-payload rejection passed.
- Authenticated canonical Staging browser: 22 explicit Save & Next/Finish saves,
  min 267 ms, mean 293.82 ms, maximum 396 ms (click to next visible date/employee).
  No timeout. Previous showed the saved date; Continue Review reopened September 7
  after the first six saves; final Finish returned with zero time exceptions.
- Exactly 22 revision-two decisions, 22 unique audited requests, 6,600 approved
  minutes, and zero later/duplicate revisions. Original 22 source revisions remain.
- Two simultaneous identical retries of a committed browser request returned the
  same decision ID; audit count remained 22. Anonymous status lookup was denied;
  private result helper and anonymous execution remain unavailable.
- Initial calculation plus one recalculation after each of the two review
  sequences: three total calculation versions, rather than one per decision.
- Automatic final calculation fingerprint matches canonical current inputs.
  105 Regular hours resolve RM840 across 21 daily priced lines. Shared Draft/Final
  payslip document projections both aggregate exactly RM840, equal to canonical
  Gross; daily calculation details remain available.
- Independent September 16/17 PH occurrence and LINDUNG evidence blockers remain
  Review Required. Gross/Net are not falsely presented as fully ready. No statutory
  evidence or PH treatment was invented to clear those unrelated blockers.
- Finalized snapshot checks passed unchanged in the cancellation/reconciliation
  contract. No finalization/payment was performed. Later compensation is retained.

The fixture is explicitly labelled `QA ONLY Save Latency Employee`, legal entity
`QA ONLY Save Latency`, September run `67af6562-bef5-43e7-80b0-93387c2ceb87`.
Only synthetic Staging decisions were made. Production received no migration,
application deployment, Payroll decision or other business-data change.

Whole-period calculation still does material work; this change removes it from
daily-save latency rather than claiming all large-month projections are cheap.
Failures outside save retain committed decisions and expose calculation recovery.
