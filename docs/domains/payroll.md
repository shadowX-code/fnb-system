# Payroll

## Ownership and Phase

Payroll is an independent People domain. Employee Master owns identity, current
employment and Legal Employer assignment. Employment Documents own immutable
agreement evidence. Payroll Profiles own approved pay basis, rates, recurring
components and statutory applicability for later calculation. Duty Roster
remains scheduled work, Attendance remains actual evidence, and neither becomes
payable time until Payroll explicitly approves a result.

Phase 1 provides profiles, effective-dated history, component definitions,
holiday context and Legal-Entity-owned run state. Phase 2 adds payable-time
evidence and exception decisions. Phase 3 adds server-owned, pre-statutory RM
calculation from approved time, effective compensation, components and sourced
pay rules. Phase 4 adds an effective-dated statutory calculation boundary and
Finalization gate. Phase 4A seeds bounded official KWSP and PERKESO table rows;
this does **not** validate every employee category or implement PCB. A Net Pay
amount is only emitted for a complete result. Historical finalized foundation
runs keep `foundation_only=true`; open and new runs use the stricter contract.

## Admin Payroll Control Center

The People Payroll UI has four destinations: Overview, Employees, Payroll Runs,
and Settings. Overview is scoped to a Legal Entity and pay period, summarizes
available financial totals and links readiness blockers to their owning
resolution step. It does not execute the Run workflow. Employees manages the
effective-dated Payroll setup without changing Employee or Contract authority.
Payroll Runs opens on a server-scoped history table with current/superseded
revisions and available totals. Opening a Run enters Prepare Payroll → Review
Payroll → Finalize. Preflight and calculation are system actions, not extra
navigation stages. Payable-time exceptions, one-period adjustments and
PCB/MTD confirmation are resolved through centered monthly employee review;
permanent setup remains in Employees. Ready and Finalize still rely on the
canonical server gates. Settings presents operational statutory methods,
The scoped Run preparation read consumes the canonical calculation projection
for time relevance and blockers, and resolves statutory setup at period start.
Later setup never supplies missing earlier evidence. Persisted one-off lines
read back independently of calculated lines; recurring components remain separate.
Review includes every Run member, including precise blockers before calculation.
shared-geography holidays, Pay Components and current supported Pay Calculation
Rules; rule publication opens only from a selected append-only rule version.
Payroll Settings uses the shared Admin underline-tab pattern below the four
primary destinations. Employee setup opens in a read-only detail drawer from a
Legal-Entity-scoped filter/list; explicit actions open the existing effective-
dated commands. Pay Components use List → View Modal → Edit/Create Modal with audited changes;
their immutable technical code is normally generated from the name and shown
under Advanced information. Their `undetermined` backend treatment remains
fail-closed but appears as Not configured, never as a normal selectable choice.
Payroll forms use the shared FeedX Select, Date Picker and Month Picker; Pay
Period is month-only, while Public Holiday and effective dates use dates.
Finalized Run revisions are read-only, and historical corrections create a new
revision rather than editing final evidence. The authorized Payroll read
projection includes the finalized approver's display name with the Run, even
when that actor is outside the selected Legal Entity's employee setup list;
this is presentation of existing finalization evidence, not a new authority.

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
shared geographic ownership and a source note. New definitions have no Legal
Entity ID: National applies across Malaysia, State uses a canonical Outlet
state code, and an explicit Outlet override applies only there. Older
Legal-Entity-scoped rows remain immutable/readable as historical overrides;
they are not silently deleted or deduplicated. The Staging preflight for this
consolidation found zero existing holiday rows. Outlet state is maintained in
the existing Outlet master and captured as append-only, date-effective
`payroll_outlet_state_versions` evidence. Earlier dates are not backfilled from
today's free-text address or state. If a State holiday exists but outlet
geography is unknown, Payable Time stays Review Required. Holiday context can
classify a shift, but does not itself establish a monetary holiday-pay rule.
Shared future holidays may be edited only while unconsumed by payable-time
evidence. The server enforces Owner/Admin authority, a reason, valid geography,
and an audited before/after event; past, legacy Legal-Entity-specific or
consumed definitions remain read-only. Finalized Payroll snapshots are never
edited by this command.
The `MY-01`–`MY-16` state/federal-territory list follows the [Department of
Statistics Malaysia state-code listing](https://www.dosm.gov.my/uploads/release-content/file_20260319123633.pdf).

Pay Component name and wage-treatment changes are audited with before/after
snapshots. If any finalized Payroll calculation used the definition, changing
its name or treatments is blocked: create a new definition instead. Status may
be deactivated for new use without rewriting existing final evidence. The
component code and type remain immutable identity.

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

## Payable Time (Phase 2)

Phase 2 stores append-only employee/day time versions. Reconciliation reads
the attendance-pinned published roster revision where available, original
Attendance, approved Leave, effective compensation context and the Payroll
holiday calendar. Normal completed shifts use the published duration less its
unpaid break; small clock noise does not add payable time. Late/early time,
extra time, missing punches, unscheduled work, mismatch, leave and holiday
ambiguity require review. A reviewer records approved minutes, any extra/OT
minutes, classification and a reason without editing source evidence. The
latest source fingerprint is rechecked before a decision; a changed source
requires reconciliation. Decisions and audit events are append-only.

Hourly employees require reconciled, approved time evidence before a Run can
become Ready. An in-progress hourly pay period cannot be marked Ready. A
finalized period requires an open correction Run before time decisions change;
the prior Run's time snapshot remains immutable. Monthly employees may have
time evidence, but it does not yet drive wage calculation. State holiday
applicability uses the date-effective canonical Outlet state where recorded;
unknown geography remains an exception, not an assumed paid holiday. Paid leave without a scheduled duration likewise
requires review. The 10-minute clock-noise threshold is aligned with existing
Crew punctuality evidence, and only suppresses an extra-time exception; it
never awards extra payable minutes.

## Pre-statutory Calculation (Phase 3)

`payroll_pay_rule_versions` is append-only and effective-dated by rule code and
pay basis. Only arithmetic identity rules (Monthly Basic Salary, Hourly Regular,
Non-payable) are seeded. Premium rates and Monthly divisor/proration policy are
not guessed: a protected Owner/Admin with Payroll manage authority must publish
a reviewed, sourced rule version. Missing or ambiguous rules leave the employee
in Review Required. A Monthly partial period or mid-period salary/component
change likewise requires an approved policy instead of silent proration.
Run membership is bounded by the employee's known joining/resignation dates.
An unknown joining date stays visible but requires calculation review rather
than silently treating an unverified month as payable.

`payroll_calculation_project` resolves the effective compensation for each work
date, current approved Payable Time evidence, effective recurring components,
reviewed Run-specific variable lines, and the applicable rule version. Hourly
regular pay uses approved Regular minutes × the effective Hourly rate; raw
Attendance duration is never wage input. Monthly Basic Salary is a separate
line. Approved premium classifications and unpaid time are priced only when a
rule exists. Reimbursements remain outside Gross Earnings, with their own line.
Each result contains named earnings/deduction lines, source IDs, rule IDs,
input fingerprint, issues, Gross Earnings, Non-statutory Deductions and
Pre-statutory Pay. No result labels this as net pay.

`payroll_run_calculation_versions` records append-only recalculations; a changed
input fingerprint marks the prior result stale. Variable component additions
and reversals use retry-safe request IDs, reasons and server audit events.
Ready/Finalized transitions require current Ready calculations in addition to
the Phase 2 time gate. A Ready Run with later input changes returns to Review
Required before recalculation; the server rejects stale finalization.
Finalization pins calculation versions in
`payroll_run_calculation_snapshots` alongside existing profile/time evidence;
prior finalized revisions are never rewritten. A correction is a new Run
revision. The draft Run UI exposes per-employee lines and rule explanations.

## Statutory Calculation (Phase 4 V1 — guarded)

The Phase 4 authority keeps reviewed applicability separate from reviewed
statutory category and tax inputs. `payroll_statutory_input_versions` is
append-only and effective-dated. Each EPF/SOCSO/EIS official schedule version
has independently sourced contribution bands. Phase 3 lines are classified
per scheme using component treatment; unknown treatment, category, schedule,
or a stale Phase 3 result blocks Ready. Payroll V1 deliberately treats PCB/MTD
as a separately confirmed statutory employee deduction, not a generic pay
component or an automatic tax estimate. For each applicable employee and Run,
an authorized Admin confirms a nonnegative RM amount with reason and optional
source/reference/note. `payroll_run_pcb_confirmations` is append-only and
retry-safe; Draft corrections add a revision and audit event. The latest
confirmation is included in the statutory input fingerprint and PCB result
line, so recalculation is required after a correction. The confirmation and
result are pinned at Finalization. A correction Run must receive its own
confirmation; the original finalized evidence remains immutable. The PCB
result line retains `scheme='pcb'`, employee amount and method/evidence metadata,
so a future automatic method can replace the authority without changing the
Run or future Payslip-facing amount contract. Missing applicable PCB stays
Review Required, never inferred RM0. A reviewed not-applicable decision is
the only zero-contribution path without confirmation.
The Profile detail exposes a scoped Admin category review backed by the
existing `payroll_statutory_input_adjust` command; it lists only supported
categories and keeps unsupported/unknown evidence unreviewed. A scoped read
returns prior versions. The shared Payroll trigger guard checks `OLD.status`
only on `payroll_runs` updates, so creating a Profile or other record is not
blocked by unrelated row shapes.
Phase 4 results and employer/employee shares are append-only; Finalization
pins the exact result, input, band and schedule evidence. Total Employer Cost
includes gross earnings, reimbursements and employer statutory contributions.
The official source authorities to reconcile before schedule publication are
[KWSP Third Schedule](https://www.kwsp.gov.my/en/epf-act-1991-third-schedule),
[PERKESO contribution schedules](https://www.perkeso.gov.my/en/contribution-rate/),
and [HASiL PCB specifications and test cases](https://www.hasil.gov.my/majikan/jadual-pcb-dan-spesifikasi-data/).
Phase 4A's conservative reconciliation boundary:

- KWSP Third Schedule Part A (Malaysian under 60) and Part E (Malaysian 60–74),
  effective October 2025: 401 continuous official bands each through RM20,000;
  the published RM3,250 example and RM5,000 boundary are checked. Above
  RM20,000, the official percentages are applied to the total monthly EPF wage
  base and their aggregate is rounded up to the next ringgit. The individual
  percentage shares and the remittance-rounding residual are retained
  separately. The V1 product decision allocates any fractional remittance
  residual to employer cost, while the employee deduction remains the
  calculated employee share. This is an explicit accounting allocation of
  KWSP's rounded total, not an increased statutory employer percentage; the
  policy identity is pinned in the statutory result. The same percentage
  treatment applies to the Part A bonus exception when reviewed ordinary wages
  are at most RM5,000 and a reviewed bonus raises monthly wages above it.
  Component bonus/ordinary classifications are append-only, effective-dated,
  source-reviewed versions; an ambiguous threshold stays Review Required.
  EPF excludes overtime, including pay for rest-day/public-holiday work as
  defined in the EPF Act. The supported categories remain bounded to Malaysian
  under-60 and ages 60–74 with reviewed applicability; other categories fail
  closed. Published KWSP examples validate the percentage/total rule; the V1
  employer-funded residual decision governs the remittance allocation.
- PERKESO Act 4 base SOCSO first/second categories, effective October 2024:
  65 bands per category with an RM6,000 ceiling. LINDUNG 24 JAM is a separate
  voluntary, employee-funded non-employment injury scheme for Malaysian
  employees; its election does not change ordinary Act 4 contribution. The
  2026 Act 4 projection therefore does not require a LINDUNG election. It
  remains bounded by reviewed applicability, supported age/citizenship and
  contribution-history categories, and resolved component wage treatment.
  Optional LINDUNG collection is outside the current Payroll calculation.
- PERKESO Act 800 EIS, effective October 2024: 65 independent bands with an
  RM6,000 ceiling. The supported automatic category is a Malaysian employee
  age 18–56 with reviewed applicability; ages 57–59 require prior-contribution
  evidence that FeedX does not yet own. EIS is bounded to this category.
- Automatic HASiL computerized MTD calculation and its TP1/TP3/YTD input
  machinery are explicitly deferred. Payroll V1 requires a confirmed manual
  PCB amount instead; an unconfirmed applicable employee cannot reach Ready.
  Future automation requires separate official validation and must preserve
  the statutory result-line contract and immutable historical evidence.

Nationality and birthdate are checked against selected contribution categories;
an arbitrary reviewed category string cannot override those facts. Unresolved
component wage treatment or missing source evidence also blocks Ready. The
Run cannot become Ready or Finalized with unresolved statutory evidence. No
current Operating Expenses or Reporting value is changed.

## Employee setup

Employee Statutory Setup is one workflow: applicability → category only where
applicable → confirmed setup. The server-resolved projection evaluates explicit
Not Applicable as a terminal resolved state, never as a missing category. PCB
has no category; Applicable PCB retains the separate manual Run confirmation.
Applicable EPF/SOCSO/EIS require supported confirmed category evidence. Missing
applicability/evidence remains Setup Required. A valid recommendation without
confirmation is Confirmation Required. Employee summary resolves upcoming
confirmed changes separately as Scheduled Change, with category and effective
date per scheme; it retains the current resolved evidence and completeness
separately. This summary never promotes future evidence into a Payroll period.
Employee list and detail consume
this same projection; it does not replace the date-effective Run calculation
gates. The centered Manage Statutory Setup flow recommends from canonical
nationality/birthdate using the existing supported-category guard. One atomic
command rechecks the evidence fingerprint under the Profile lock and delegates
to both append-only authorities with the same effective date. Source, actor/time
and evidence are recorded automatically for recommendation confirmation;
The compact scheme rows reevaluate recommendations whenever applicability or
the effective date changes. Complete Setup explains the specific missing or
unsupported canonical evidence and directs identity corrections to Employee
Master; free text cannot establish unsupported eligibility. Only a deliberate
change from a valid recommendation expands supporting source/override reason.
Earlier evidence and finalized snapshots remain immutable.
The suggested date follows both latest applicability/category versions, never
an inferred historical entitlement. Settings exposes schedule sources read-only.

Employee Manage Components owns assignment/amount, distinct from Settings
definitions and one-period Run adjustments. Add, Change Amount and Stop append
versions through `payroll_recurring_adjust`; a stop writes an inactive zero
version, never deletes history. Future starts/changes/stops remain visible.
Dates must follow the latest scheduled version and finalized-period protection
is unchanged. Retired definitions permit stopping an existing assignment only.

## Deferred

Payslips, settlement and Finance labour-cost projections remain deferred.
