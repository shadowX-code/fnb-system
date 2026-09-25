# Payroll Foundation

## Ownership and Phase

Payroll is an independent People domain. Employee Master owns identity, current
employment and Legal Employer assignment. Employment Documents own immutable
agreement evidence. Payroll Profiles own approved pay basis, rates, recurring
components and statutory applicability for later calculation. Duty Roster
remains scheduled work, Attendance remains actual evidence, and neither becomes
payable time until Payroll explicitly approves a result in a later phase.

Phase 1 provides profiles, effective-dated history, component definitions,
holiday context and Legal-Entity-owned run state. It does **not** calculate
payable hours, gross/net wages, EPF/SOCSO/EIS/PCB amounts, employer cost,
payment, or payslips. A Phase 1 finalized run is marked `foundation_only`
and pins input-profile evidence only; it must not be represented as a payable
or paid payroll.

## Profile and Compensation Authority

One `payroll_profiles` row identifies an employee's Payroll relationship.
`payroll_compensation_versions` append immutable effective-from versions.
The next version's date defines the preceding version's end; no historical
row is rewritten. Exactly one Monthly basic salary or Hourly rate is stored
per version, with Legal Entity, currency, optional reliable cost outlet,
workplace snapshot, approving Admin employee, reason, provenance and optional
Employment Document reference. Basis is independent of Employment Type.
Changes require a later effective date and are rejected for a finalized
period; a controlled correction is required there.

`payroll_recurring_component_versions` append effective-dated allowance or
deduction assignments. Definitions carry distinct, currently
`undetermined` EPF/SOCSO/EIS/PCB wage-treatment metadata, not one shared
statutory gross. `payroll_statutory_profile_versions` record independently
reviewed employee applicability for each scheme; null means unreviewed.
Neither table contains contribution amounts or rates. Explicit changes
require Payroll manage permission, a reason and server-derived audit actor.
No contract or Employee update automatically creates or changes a Payroll
version.

## Holiday and Run Foundation

`payroll_public_holidays` records dated national/state/outlet context under
a Legal Entity and a source note. The later pay engine must establish which
holidays and statutory rules apply to each shift; this calendar alone is not
a holiday-pay calculation.

`payroll_periods` own one Legal Entity and complete calendar month.
`payroll_runs` have Draft → Review Required → Ready → Finalized states in
Phase 1; Paid is reserved in the schema but no Phase 1 command can enter it.
Finalization pins immutable profile/version snapshots and sets the period's
current-finalized pointer. A correction begins a new revision linked to that
current finalized run; later finalization moves the pointer atomically while
leaving the original run and snapshots intact. A future payslip authority
will use that pointer to expose only the current final payslip to Crew, while
Admin/Audit retains superseded evidence. Entitlement and settlement remain
separate.

## Permissions and Security

The People Payroll route requires `payroll.view`. Profile mutation requires
`payroll.manage` plus employee scope; finalization requires
`payroll.finalize`. Legal-Entity-wide runs and settings additionally
require a protected Owner/Admin role. The new permissions are seeded only
for Owner/Admin, not copied from Employees visibility. Public Payroll tables
have RLS enabled and no direct client table privileges; authenticated Admins
use narrow SECURITY DEFINER commands. All commands derive identity, enforce
permission/scope/state, and write server-timestamped events. Direct deletion
and historical-version mutation are rejected. Crew has no Phase 1 Payroll
authority.

## Deferred

Phase 2 must define and approve payable time from published roster, original
attendance and leave evidence. Later phases need versioned pay rules,
verified Malaysian statutory calculation, monetary run lines, immutable
payslips, settlement and Finance labour-cost projections. No current
Operating Expenses or Reporting value is changed by Phase 1.
