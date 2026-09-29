# People Employment Timeline Production release candidate

Production/main baseline: `34256338ccae01a6cd8fe23aa0da4d65b626045c`
Canonical Staging source: `c4ffe761a452525be9d8371a4f79d5c36b975689`
Verified Malaysia cutover date: **2026-09-29**

## Ordered migration manifest

1. `20260929024532_people_employment_assignment_timeline.sql`
2. `20260929025028_people_employment_assignment_validation.sql`
3. `20260929025447_people_employment_assignment_function_grants.sql`
4. `20260929033032_leave_employment_eligibility_v2.sql`
5. `20260929034204_leave_unresolved_balance_read.sql`
6. `20260929034548_leave_resigned_year_grant_guard.sql`
7. `20260929034848_leave_current_eligibility_read.sql`
8. `20260929042209_payroll_period_employment_timeline.sql`
9. `20260929042803_payroll_period_employment_scope_correction.sql`
10. `20260929050707_roster_employment_date_eligibility.sql`
11. `20260929051529_roster_employment_picker_date_keys.sql`
12. `20260929051713_roster_direct_write_date_scope.sql`
13. `20260929052542_roster_republish_retained_identity.sql`
14. `20260929055243_crew_performance_employment_period.sql`
15. `20260929060145_crew_performance_period_read_closure.sql`
16. `20260929073343_attendance_employment_history_presentation.sql`
17. `20260929083716_employment_reactivation_period_bounds.sql`
18. `20260929084052_payroll_reactivation_midperiod_review.sql`

## Release isolation and data impact

The candidate includes People Employment Assignment Timeline, Leave eligibility and proration, Payroll open-period membership and Draft identity, dated Roster eligibility, Performance period eligibility and attribution, Attendance historical labels, and final resignation/reactivation boundaries. Production retains its existing Peer Review authority; the Performance migration consumes it and holds a subject from another outlet pending review. Team Review, Inventory performance, Factory and Guest AI changes are excluded.

The first People migration inserts exactly one `cutover_current` revision from each Employee row using the Malaysia transaction date. A read-only Production check on 2026-09-29 found **59 Employee rows**, all with supported employment type/status and non-empty position/workplace. Fifteen resigned or terminated employees have no recorded end date; the baseline preserves that absence rather than inferring one. The new-employee trigger creates only a `new_employee` current baseline. Dates before each verified baseline resolve as unknown. No historical assignments are inferred from Joined Date, documents, Payroll, roster or Attendance.

Leave creates current policy versions for **16 existing policies** and records enforcement observations for **145 legacy entitlements**. Existing entitlement, published Roster, Attendance, Payroll and Performance evidence is retained. Production currently has **96 published roster revisions**, no Payroll runs, **one open Performance result**, and no finalized Performance results. The open result requires period-correct review after cutover; retained published and final evidence is not rewritten. Production has no existing Peer Review subjects.

## Verification

- Production applied ledger: **531** versions through `20260928154126`; none of these 18 are applied.
- Disposable local database: all 531 baseline schema migrations followed by these 18 in manifest order; resulting ledger **549** versions through `20260929084052`.
- One existing Factory migration's three-row Production-specific data repair was omitted only in the empty local baseline replay. Its schema statements and all candidate migrations were applied. No Production database mutation was performed.
- Rollback-only local fixture: a new Employee got exactly one current `new_employee` revision dated 2026-09-29, and the preceding date was unresolved.
- Affected-domain verification: 82 focused tests across People, Leave, Payroll, Roster, Performance and Attendance; production build passed. The added Production Peer Review compatibility contract passed.

No main merge or Production deployment is part of this candidate.
