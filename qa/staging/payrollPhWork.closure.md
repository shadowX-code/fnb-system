# Annual paid holidays and company PH benefit — Staging closure

Verified 26 September 2026 on canonical `fnb-system-staging.vercel.app`, Git
Integration deployment `dpl_FrS2nXNEC7QCLEYiK5GKzgC7w3Sa`, application SHA
`bfe0f6d6b12eabe8732c59c326213ee45b9e19c4`.

## Boundary

User explicitly approved isolated synthetic QA calendars/policies, then separate
no-access Monthly/Hourly employee, workplace, roster/Attendance and Leave
fixtures. These are **not official annual calendars** and must not be used as
company operational policy. An authoritative complete annual import remains
required before real operational use. No Production, existing employee/source
record, statutory premium, payslip, payment or Finance mutation occurred.

Annual authenticated Draft → Publish QA preceded PH benefit QA. Required
holidays stayed selected/locked, optional holiday selection remained editable,
published snapshots/audit were retained. Rollback authority tests cover
National/State applicability, explicit outlet override, non-selection,
missing policy, stale evidence, retries and immutability.

## Fixture inputs and independent expectations

Run `7adc00ce-9f58-43d8-b587-9fd17e7a27af`, August 2026, QA ONLY PH Benefit
d2342702; outlet QA ONLY PH Workplace d2342702 (MY-08).

- Monthly employee `51058e0a-3bc2-4ca2-9726-97635f68f060`: Basic RM2,600.
- Hourly employee `765e3df0-5f8b-409a-99b0-2fb4eca2fc85`: rate RM15/hour.
- Selected QA holiday/work date 31 August; published working shift 09:00–15:00,
  unpaid break 60 minutes; matching complete Attendance; approved PH time 300
  minutes. Source creation/reconciliation was fixture setup, not a UI test.
- EPF Malaysian under 60, SOCSO Act 4 First Category, EIS Standard, PCB N/A.

| Scenario | Expected | Authenticated actual |
|---|---|---|
| Monthly additional company benefit | 2600 / 26 = RM100 | RM100; Gross RM2700, employee deductions RM304.55, Net RM2395.45 |
| Hourly ordinary + additional benefit | 15 × 5 = RM75 each | Two separate RM75 lines; Gross RM150, deductions RM10.20, Net RM139.80 |
| Monthly Replacement Leave | Basic RM2600; no additional earning; 1 Leave day | Gross RM2600, deductions RM303.85, Net RM2296.15; 1 day granted |

EPF base excludes the separate PH-work additional benefit (Monthly RM2600,
Hourly RM75); SOCSO/EIS bases include it (RM2700/RM150). Ordinary earnings are
not counted twice. This company benefit does not establish statutory PH compliance.

## Authenticated actions and evidence

- Use Recommended Treatment on both employees → immediate employee-only
  calculation/statutory read-back; formula, roster, clock and approved hours shown.
- Settings appended Replacement Leave policy effective 31 August for QA entity
  only. Stale prior decisions became Review Required; old amounts became pending.
- Monthly Pay → Leave → Pay → Leave: additional earning removed/restored,
  unconsumed Leave grant revoked/regranted through canonical Leave adjustments.
- One isolated pending Replacement Leave request was source-fixture setup;
  `crew_leave_review` approved it through canonical Leave authority. One day was
  allocated to the active source grant. UI attempted Leave → Pay and correctly
  blocked with “Replacement Leave has been consumed. Manual resolution is required.”
- Hourly explicitly reconfirmed Additional Pay under current policy.
- Authenticated Prepare → Review Required → Ready → Finalized. Frozen table and
  employee statements read their pinned revision, not current setup.
- Final result: Gross RM2750, employee deductions RM314.05, Net RM2435.95,
  employer contributions RM402.05, total employer cost RM3152.05.
- Six successful treatment decisions, exactly one event each; one Finalize event.
  Two historical grants, one revocation, one active source grant consumed once.
  A revoked/regranted historical pair is not a duplicate active entitlement.
- Rollback tests also prove identical request retries, expiry/no carry-forward,
  non-PH/non-worked exclusion, unsupported extra-time gate and anonymous denial.
- Published roster/Attendance before/after hash identical:
  `6e8cc4da1be137aa75ef5522abad337b`.
- Finalized calculation snapshots hash `fb57132b569b6d3d69eb485097da40b4` stayed
  unchanged after a later QA policy version and master retirement. Finalized
  treatment mutation was rejected. Frozen PH read stayed identical.
- Only console error was the deliberately rejected consumed-leave command;
  no unexpected runtime errors. A real name/recommendation display defect was
  fixed at the presentation contract and focused tests/build rerun.

## Cleanup

Both employees retired/resigned, system login disabled, no auth user or Role.
QA outlet and both QA Legal Entities (annual publication and PH-work) inactive.
Zero active Crew Access and zero active Crew sessions. No access was created.
Retained deliberately: published QA annual calendars/policies, source shifts and
Attendance, approved payable-time history, treatment/grant/revocation/consumption
evidence, approved Replacement Leave, finalized payroll snapshots and audit.
These are clearly QA-only history and were not deleted or rewritten.

## Verification

PH rollback lifecycle suite passed with rollback residue zero. Focused Payroll
UI suite 23 tests passed; focused Leave/Attendance suite 25 tests passed; final
PH presentation correction 4 tests passed. Build and `git diff --check` passed.
Payroll and Crew workforce authority documents updated. No Production release.
