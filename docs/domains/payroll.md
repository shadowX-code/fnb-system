# Payroll

## Company paid-holiday work benefit

Company Paid Holiday selection, confirmed work and company benefit are separate
authorities. The annual published policy supplies applicability; published working
roster, complete Attendance and current approved PH Payable Time supply work evidence.
`payroll_ph_work_project` / scoped `payroll_ph_work_read` are side-effect-free.
An effective Legal-Entity company benefit policy recommends Additional Pay or
Replacement Leave. No statutory baseline/premium is inferred from this policy.

`payroll_ph_work_confirm` locks the Draft/Correction Run and employee Leave scope,
rechecks the source fingerprint, appends a request-bound decision, reconciles the
source-linked Leave grant and recalculates only that employee in one transaction.
Monthly Basic continues: the separate company benefit is effective Monthly Basic
/ 26 × 1 day. Hourly ordinary earnings reuse Regular pricing for approved PH hours;
the additional company benefit is effective Hourly Rate × those approved hours.
Raw clocks never price wages. PH OT remains blocked. A missing policy, confirmation,
or stale decision blocks calculation readiness, rather than guessing a premium.

The distinguishable `company_ph_benefit` line excludes EPF under KWSP's additional
PH-work/overtime definition and includes ordinary Act 4/800 PH-work wage treatment;
ordinary Monthly Basic / Hourly Regular retains its existing inclusion. Sources and
formula/policy/time/compensation/decision identities are pinned with the calculation.
PCB remains manual-confirmed. Finalization freezes PH evidence inside existing
calculation snapshots; finalized statements never resolve it from live policies.
Post-finalization monetary changes require the existing Correction Revision.

Replacement Leave belongs to canonical Crew Leave, not a Payroll balance. Draft
Pay ↔ Leave changes append decisions and signed Leave adjustments. A used source
grant or insufficient unreserved balance blocks switching to Pay. No source
Holiday, published roster, Attendance or historical decision is rewritten.

## Operational draft and finalized-record presentation

Prepare Payroll uses one exception-first employee table; status is not duplicated
by review tabs. A Draft or Review Required revision permits Add, Edit and Remove
of this-period adjustments with an optional remark. `payroll_draft_adjustment_save`
delegates to the canonical append-only add/reverse commands: Edit atomically
retires the prior input and appends a replacement, while Remove retains history.
Request identities protect retries and stale edits are rejected. The client
recalculates only the affected employee and refreshes the canonical earnings and
statutory projections after success. Finalized revisions expose no editing path.

`payroll_component_save` delegates to existing component create/update authority,
records system source and actor/time for ordinary configuration, and requires
explicit Included/Excluded wage treatment for all schemes. Available for use
controls future assignment only; fixed Type and finalized-use guards remain.

Finalized Payroll is a read-only Payroll Record, with employee rows and statements
read through `payroll_finalized_record_read` from profile, calculation and statutory
snapshots. Names and financial values never fall back to current employee setup.
Older foundation revisions without financial snapshots explicitly show unavailable
evidence rather than inventing values. Corrections remain separate revisions;
this presentation does not create a payslip or payment authority.

Employee monthly review exposes **Review Hours** only for time-dependent employees (all Hourly employees, and Monthly employees whose canonical preparation projection identifies relevant time). The centered review reads `payroll_time_read` snapshots, displays roster/clock/proposed/approved evidence and exception-first rows, and uses `payroll_time_decide` for unresolved exceptions. Clean days require no repeated confirmation. A successful decision runs `payroll_employee_recalculate` (earnings and statutory core together) then refreshes employee, preparation and review projections. If refresh fails after persistence, retry refresh only—not the decision. Regular earnings and effective rates shown here come from persisted calculation lines, not a second UI wage calculator. Original work evidence and finalized snapshots remain under their existing immutable authorities.

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
canonical server gates.

The scoped Run preparation read consumes the canonical calculation projection
for time relevance and blockers, and resolves statutory setup at period start.
Later setup never supplies missing earlier evidence. Persisted one-off lines
read back independently of calculated lines; recurring components remain separate.
Review includes every Run member, including precise blockers before calculation.
Monthly employee review and Review Payroll consume the same persisted calculation
and statutory results. Stale/incomplete results do not present contributions or
Net Pay as current. Run setup labels consume period-start resolved scheme state,
not today's Employee setup. One-period adjustment/PCB confirmation read-back
refreshes only the affected employee through `payroll_employee_recalculate`,
which delegates to shared earnings/statutory calculation cores under the Run
lock. Bulk calculation uses those same cores. Changed fingerprints append
versions/audit evidence; retries with unchanged inputs create no extra versions.
Permanent setup changes do not trigger this refresh automatically.
Settings presents operational statutory methods, shared-geography holidays,
Pay Components and current supported Pay Calculation
Rules; rule publication opens only from a selected append-only rule version.
Payroll Settings uses the shared Admin underline-tab pattern below the four
primary destinations. Employee setup opens in a read-only detail drawer from a
Legal-Entity-scoped filter/list; explicit actions open the existing effective-
dated commands. Pay Components use List → View Modal → Edit/Create Modal with audited changes;
their immutable technical code is generated from the name and remains internal.
The registry shows individual EPF/SOCSO/EIS/PCB wage-base inclusion icons with
focus/hover explanations. Create/edit uses shared Included/Excluded segmented
controls; these describe component wage bases, not employee applicability.
Their `undetermined` backend treatment remains
fail-closed but appears as Not configured, never as a normal selectable choice.
One-off adjustment type derives from the chosen canonical component. Employee
review attaches adjustment reason/reversal to its calculated line instead of
repeating the amount in a separate financial section. Reimbursements remain
outside Gross Earnings and are explicitly included in the payment reconciliation.
Employer contributions remain separate from employee deductions and Net Pay.
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

### Annual Company Paid Holiday authority

Shared National/State holiday definitions are source-reviewed into append-only
`payroll_holiday_calendar_versions`; no dates or classifications are guessed or
seeded. Publication requires an explicit complete-source review. Each entry pins
the holiday definition, required/gazetted/special/substitute classification,
source and optional original-holiday link. Published sources cannot be edited;
previously published required holidays cannot be removed or downgraded.

`payroll_paid_holiday_policy_versions` separately selects paid holidays from an
exact published calendar. One policy may cover multiple Legal Entities; an
explicit, reasoned outlet override wins over the shared company assignment.
Publication atomically advances assignment pointers, retaining prior versions
and audit evidence. Required holidays cannot be deselected. Draft saving and
publication have payload-bound retry identities and stale-version checks.

Settings → Public Holidays exposes Holiday Calendar and Company Policy.
The operational table shows Required / Selected / Not Selected; technical source,
classification and publication evidence stays in Details/History. The default
selection command derives active Legal Entities server-side and delegates to the
existing publication authority. Explicit company/outlet exceptions retain their
scope/collision guards; changing a frozen scope is not an implicit reassignment.
The compact Working on a Paid Holiday section delegates shared confirmation
atomically to each company's existing date-effective PH-benefit command. Its
formula, Payroll/Leave decisions and finalization boundaries are unchanged.
Overall setup readiness also requires date-effective company PH-benefit evidence;
it does not substitute for the work-date-effective Payroll resolver.

Official-source ingestion is reviewed import, not unattended synchronization.
JPM/BKPP publishes [annual calendars](https://www.kabinet.gov.my/hari-kelepasan-am/)
and separate [special-holiday gazettes](https://www.kabinet.gov.my/akta-dan-warta/).
No verified machine-readable provider exists in the repository. A reviewed JSON
manifest supplies actual dates, National/State scope, explicit classifications,
source references and substitute linkage; unresolved rows cannot be imported.
The server pins the manifest SHA-256, source, actor/time and retry identity,
reuses canonical holiday creation/calendar publication and never advances company
assignments during source import. Automated official import remains blocked
pending a verified maintained annual/special/substitute source contract.
An inactive-company calendar can be explicitly retired with append-only evidence;
retirement excludes it from future authoring/default reads, never historical
resolution, definitions or finalized snapshots. Required holidays from active
calendars still cannot be downgraded. Add Holiday remains the sourced-definition command, not a company
selection or automatic publication. Historical outlet/entity-specific definitions
remain readable and do not silently become selected annual paid holidays.

`payroll_paid_holiday_resolve` is the sole date/company/outlet/geography authority
consumed by payable time. A gazetted but non-selected date stays ordinary work.
A potentially applicable holiday without a published policy, or a selected State
holiday with unknown effective geography, remains Review Required. Selected
holiday evidence pins calendar/policy versions; reads never create records.
Normal unrelated time fingerprints and all finalized snapshots are preserved.
Company observation is not a statutory premium rule or a claim that company
benefits discharge statutory PH obligations. Benefit treatment remains gated on
verification of this upstream authority.

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
Non-payable) are seeded. Premium rates and Monthly ordinary-rate divisor policy are
not guessed: a protected Owner/Admin with Payroll manage authority must publish
a reviewed, sourced rule version. Missing or ambiguous rules leave the employee
in Review Required. Mid-period salary/component changes still require an approved
policy instead of rate blending or silent proration.
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

### Monthly Basic entitlement / approved Unpaid Leave

`payroll_monthly_rule_confirm` records a real authorized Owner/Admin's audited,
retry-safe confirmation of the fixed `ea18a_calendar_days_v1` formula. It is not
an editable premium multiplier. Effective from 1 January 2023, the formula is
Monthly Basic Salary / calendar days in the wage period × eligible calendar days,
under [Employment Act 1955 s18A](https://jtksm.mohr.gov.my/sites/default/files/2023-11/Akta%20Kerja%201955%20%28Akta%20265%29.pdf)
and [JTKSM BPP2026 guidance](https://jtksm.mohr.gov.my/sites/default/files/2026-04/BPP2026%20-%20Pembayaran%20Upah.pdf).
The private `payroll_monthly_entitlement` helper is consumed by the existing
calculation projection, not a second calculator. It intersects inclusive
joining/last-employment dates with the month and removes distinct approved
full-day Unpaid Leave dates inside that employment window. Roster minutes are
not needed; a Payroll time decision cannot erase canonical approved leave.
The final Basic amount is rounded once to RM0.01. Its earning line retains
salary, date/day counts, approved leave snapshots and rule/geography versions.
Employee Review and frozen statements display nominal salary, reductions and
payable Basic without creating a second deduction.

For Monthly mid-month joiners, contribution applicability/category evidence,
PCB applicability and Run preparation use the first eligible employment day
through the shared private `payroll_employee_period_start` cutoff. They do not
require an invented pre-employment setup date. Later category/applicability
changes still require review; official schedules retain their monthly period
resolution and historical finalized snapshots remain unchanged.

The supported geography is Peninsular Malaysia/Labuan, established through the
compensation workplace/outlet snapshot and effective outlet-state evidence.
Unknown/out-of-scope geography, half-day leave, overlapping approved leave,
attendance conflicting with unpaid leave, salary blending and incomplete-month
recurring component entitlements remain Review Required. No arbitrary final-RM
override or generic absence/late deduction is introduced. Source corrections
remain in their canonical owning workflow and require Payroll recalculation.

Actual payable Basic feeds the existing EPF/SOCSO/EIS `monthly_basic` wage-base
treatment. This follows [KWSP salary/wage guidance](https://www.kwsp.gov.my/en/employer/responsibilities/mandatory-contribution)
and [PERKESO wages payable definition](https://www.perkeso.gov.my/uncategorised/774-employer-eligibility.html),
with EIS wages under [Act 800](https://perkeso.gov.my/images/akta/ACT%20800/Akta%20800_EMPLOYMENT%20INSURANCE%20SYSTEM%20ACT%202017.pdf).
It does not classify approved Unpaid Leave as the unresolved generic
`unpaid_time` deduction or subtract nominal salary again. Monthly lateness/early
departure remains separate and requires its own approved treatment. PCB retains
V1 manual confirmation. Premium, paid-leave pricing, payslip and payment
authorities are unchanged. Finalization pins this calculation as usual; changes
after finalization require a correction revision, never snapshot rewrites.

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

Initial Set Up Employee uses the same private statutory recommendation core as
Manage Statutory Setup before a Payroll Profile exists. Employee/applicability/
effective-date changes reload the scoped server recommendation. One initial
confirmation locks the Employee, rechecks its evidence fingerprint and delegates
to the existing profile and category append commands in one transaction.
Supported recommendations are confirmed without manual provenance; source,
Admin and time are recorded automatically. Unsupported applicable schemes stay
Setup Required with their canonical reason, while compensation and other resolved
schemes are saved. PCB is applicability-only. Existing override/completion,
period-effective calculation and finalized evidence boundaries are unchanged.

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
Setup confirmation distinguishes a stale evidence fingerprint from an invalid
effective date. Stale information requires explicit same-modal Refresh Setup;
the fingerprint includes latest applicability/category versions, including
future changes. The date must follow both latest versions, not today's suggested
default. Historical later dates remain subject to existing finalized-period
guards. The shared Date Picker disables days below the server-provided minimum.
The suggested date follows both latest applicability/category versions, never
an inferred historical entitlement. Settings exposes schedule sources read-only.

Employee Manage Components owns assignment/amount, distinct from Settings
definitions and one-period Run adjustments. The Employee registry reads Joined
from the existing scoped Employee projection, current pay and last effective
pay change from compensation history, and active component counts from the
same effective-dated selector as Manage Components. Individual scheme icons
consume the server setup summary, with focus/hover details; secondary columns
collapse at narrower Admin widths while detail retains complete evidence.

Employee Manage Components owns assignment/amount, distinct from Settings
definitions and one-period Run adjustments. Add, Change Amount and Stop append
versions through `payroll_recurring_adjust`; a stop writes an inactive zero
version, never deletes history. Future starts/changes/stops remain visible.
Dates must follow the latest scheduled version and finalized-period protection
is unchanged. Retired definitions permit stopping an existing assignment only.

## Deferred

Payslips, settlement and Finance labour-cost projections remain deferred.
