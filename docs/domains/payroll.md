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
The company policy's historical Additional Pay recommendation uses Monthly Basic
/ 26 × one benefit day or Hourly Rate × approved hours. This is a company benefit,
not the statutory Malaysia PH entitlement.

## Malaysia statutory public-holiday pricing

The canonical chain is published paid calendar → People employment and reviewed
legal coverage/eligibility → current approved PH time → official statutory PH pack
→ explicitly applicable company benefit → canonical priced earnings. No employment,
holiday eligibility, normal hours or prior wage evidence is backfilled.

### Operational PH Pay Treatment

The normal employee/date review has one PH cash treatment: **Statutory PH Pay**,
**Company PH Allowance**, **Custom PH Allowance** or **No Additional PH Pay**.
Published calendar and canonical approved Payable Time remain prerequisites; editing
time delegates to the existing audited correction command. A date-effective **Default
PH Pay Treatment** preselects Statutory, Company or no default; every occurrence still
requires explicit confirmation. Settings normally shows the current policy, with
prior/future versions under View history.

Company PH Allowance reuses the existing `Additional Pay` formula/version/scope:
monthly Basic Salary ÷ 26; hourly approved normal PH hours × effective Hourly Rate.
`payroll_ph_company_allowance` is the single extracted existing calculator used by
both the retained legacy projection and unified quote. Historical `additional_pay`
policies remain date-effective Company defaults without rewriting policy evidence.
Company is an alternative treatment, never an extra layer over Statutory/Custom/zero.
New cash defaults do not supersede retained legacy Leave policies or grants. An active
Replacement Leave grant requires resolution through Leave before a unified cash
confirmation; this workflow never revokes or consumes Leave automatically.

`payroll_ph_treatment_preview` returns canonical earning lines, statutory comparison,
compliance warnings, total day earnings and correction delta. Confirmation binds the
source and exact quote fingerprint including prior review; UI edits invalidate the
quote. The UI never calculates Payroll. Company hourly Regular wages are separately
priced by the existing regular rule; monthly Basic stays in period Basic Salary.
Statutory ordinary holiday pay remains within Public Holiday Allowance. PH OT remains
separate; Company treatment with overtime cannot confirm an unavailable statutory OT
amount. Custom treatment uses its existing explicit separately classified OT amount.

All unified non-OT holiday cash is labelled exactly **Public Holiday Allowance** in
Review and canonical Draft/Final Payslip aggregation. Contribution classifications
remain unchanged. Legacy decisions/snapshots retain their original semantics and
labels; daily pricing and decisions remain auditable.

Unavailable Statutory treatment is disabled. Company/Custom/zero do not assert
statutory compliance; missing evidence and comparison warnings stay in reviews,
events, calculation inputs and finalized snapshots. Normal occurrence review exposes
no statutory internal forms, reference field, benefit selector or acknowledgement
checkbox. Explicit confirmation records warning handling server-side. Reusable PH
profile/historical wage authorities remain accessible through Payroll Profile Advanced
compliance tooling and continue to determine statutory quotes.

Custom, zero, Payable Time edits and corrections require a reason. A first Statutory
or Company confirmation of already approved time records a server-owned confirmation
reason when none is supplied. The existing `payroll_ph_statutory_confirm` remains the
single append/atomic recalculation authority with actor, time, warnings and prior
revision. Retry IDs remain idempotent; finalized/paid mutation remains prohibited.

### Reusable PH Pay Profile and day review

`payroll_ph_profile_versions` owns employee coverage, First Schedule category,
contractual daily/weekly hours, regular part-time comparison/exclusions and company
benefit overlap evidence. Confirm through scoped `payroll_ph_profile_save`; effective
revisions carry forward until superseded. Dated employment establishes full-time
context, and only completed matching template contracts establish contractual hours.
Later completed uploaded contracts also require profile review; superseded completed
contracts remain evidence for their historical dates.
Job title, roster and pay basis never establish a legal category. Changes to employment
type, position, employer, pay basis, completed contract or company policy require
profile review; compensation changes independently re-resolve wage evidence. Prior
revisions remain immutable. Payroll Profiles and Run/day setup use the same command.

`payroll_ph_wage_resolve` derives preceding qualifying regular wages/worked days from
a complete canonical calculation: frozen Final evidence or an open calculation whose
canonical input fingerprint still matches. It excludes premium earning categories and
does not guess the treatment of additional earning components. Pure Monthly Basic can
supply the ordinary/threshold wage basis; other remuneration requires explicit evidence.
Manual wage basis remains bound to compensation, earning components and adjustments.
Missing prior-month evidence uses `payroll_ph_wage_evidence_save` once per employee,
employer and preceding wage period; append-only corrections bind the current original
time/compensation/component source fingerprint. No confirmed current state proves
older coverage, and historical source changes invalidate reusable manual wages.

`payroll_ph_eligibility_reviews` remains append-only Run/employee/day evidence.
Legacy profile-based occurrence reviews accepted: retain approved time,
explicitly approve roster hours, adjust time, confirm an eligible paid day not worked,
or retain unresolved absence/substitution. It derives actor, checks Run/employee outlet
scope, locks the open Run, requires a decision/correction reason, checks current context,
delegates time changes to `payroll_time_decision_save`, appends the occurrence and
recalculates atomically. Client legal/wage input is rejected. An absence concern cannot
invent forfeiture or zero entitlement. Original Leave and pricing blockers remain.

The effective projection combines the dated Profile, derived/reviewed wages and latest
occurrence. Setup from a Run returns to the same employee/date; subsequent holidays
reuse the profile and wage-period evidence. Snapshots pin resolved Profile/wage evidence
alongside the day review. Legacy per-day reviews retain their original context-bound
pricing semantics; they are not promoted into reusable profiles. Final/paid reads use
frozen calculation evidence, and new setup affecting frozen periods requires the
existing governed Payroll correction workflow.

The effective `my_ph_2023_v1` formula pack extends the existing pay-rule registry;
it is not a generic time multiplier. Generic PH rule publishing/pricing is disabled.
For verified adult Employment Act full-time coverage, paid holiday wages are included
in unabated Monthly Basic; Hourly paid-day wages use qualifying preceding monthly
wage-period wages / qualifying actual worked days (s60I(1C)). Monthly ordinary-day
wages are verified ordinary monthly wages / 26; ordinary hourly rate is ordinary-day
wages / verified contractual normal daily hours (s60I). Covered holiday work receives
two ordinary days in addition to holiday pay even for a shorter full-time shift;
excess approved hours receive 3× ordinary hourly rate (s60D(3)).

First Schedule premium coverage uses separately evidenced statutory monthly wages
and qualifying category: general employees at RM4,000 or less, or qualifying manual,
vehicle, manual-supervision or vessel categories regardless of wages. Job title/pay
basis is not legal-category evidence. General employees above the threshold retain
holiday-pay rights, but worked PH pay remains Review Required pending verified
contractual authority; no unsupported zero or statutory work premium is issued.

Verified regular part-time coverage requires contractual weekly/comparable hours
and exclusion review, not merely the People `part_time` label. Normal PH work adds
two ordinary days; approved excess between part-time and comparable full-time daily
hours receives 2×, and excess above the full-time boundary receives 3× (reg6). Partial
part-time normal-day work, excluded casual/home/domestic categories, unknown age or
under-18 hours, Sabah/Sarawak, non-monthly wage periods, missing preceding wages,
forfeiture and substitute-holiday questions remain explicitly Review Required.
Approved annual/medical/unpaid Leave on the paid day cannot be cleared merely by
selecting Eligible. Published substitute-day and absence evidence must be resolved.

Company Additional Pay never creates statutory entitlement. Reviewed contract evidence
must specify no applicable benefit, an inclusive top-up (only company amount exceeding
the statutory normal-work premium), or a genuinely additional benefit. An applicable
benefit also requires the existing company treatment/work authority. Replacement
Leave remains an additional company entitlement and does not replace statutory cash.
The statutory lines may resolve while an independent benefit confirmation is blocked.

PH/PH-OT priced lines share `Public Holiday Allowance` presentation, with separate
ordinary-day/hour units and compatible rate, multiplier, legal coverage, normal-hour,
rule and compensation groups. Gross sums rounded daily amounts exactly. Original
daily lines and review evidence remain available in Calculation details; Draft/Final
Payslips use the same server groups. Frozen snapshots/artifacts are never recalculated.
Ordinary statutory packs are unchanged: paid-day wages use normal contribution
classification, PH work/OT follows the existing EPF overtime boundary and Act4 wage
classification; PCB remains its governed confirmation authority.

Primary evidence: [JTKSM Employment Act ss60D/60I and First Schedule](https://jtksm.mohr.gov.my/sites/default/files/2023-11/Akta%20Kerja%201955%20(Akta%20265).pdf),
[JTKSM Part-Time Regulations reg6](https://jtksm.mohr.gov.my/sites/default/files/2023-03/10.%20Employment%20-%20Part-time%20Employees%20-%20Regulations%202010%20%20%281%29.pdf),
[JTKSM 2022 amendment FAQ](https://jtksm.mohr.gov.my/ms/soalan-lazim/akta-kerja-1955-pindaan-2022),
[KWSP contributions](https://www.kwsp.gov.my/en/employer/responsibilities/option-contribute),
and [PERKESO wage definition](https://perkeso.gov.my/en/our-services/employer-employee/employer-registration.html).

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

Employee monthly review exposes **Review Hours** only for time-dependent employees (all Hourly employees, and Monthly employees whose canonical preparation projection identifies relevant time). The centered review reads `payroll_time_read` snapshots, displays roster/clock/proposed/approved evidence and exception-first rows, and uses the Run-scoped `payroll_time_decision_save` adapter over the existing `payroll_time_decide` append authority. Clean days require no repeated confirmation. Exception review keeps employee/period navigation across refreshes and uses an explicit per-date queue with progress, Previous, Save & Next/Finish and Continue Review at the first unresolved date. Saved dates remain inspectable. Authorized open-run reviewers may Correct Decision with a new mandatory reason; the new version supersedes rather than edits the previous decision. Run/employee/date scope, latest version, current source fingerprint, request/payload-bound retry and finalized-period correction gates are enforced server-side. Correction audit pins the Run, actor, prior/new time versions and reason. Missing-punch dates with published working-shift evidence offer roster-minute prefill through the existing adjustment decision; roster evidence does not prove attendance. Null proposed minutes cannot be approved as a proposal. Reason shortcuts remain editable and require explicit save. A successful Run decision commits the appended time revision and audit together, returns canonical day read-back, and advances the retained queue without month recalculation. Changed time identity invalidates the existing calculation fingerprint. Queue completion/return automatically coalesces `payroll_employee_recalculate` before fresh financial projections. Calculation failure cannot undo a committed decision; unresolved evidence remains Pending Review. Ambiguous save responses use audited request read-back and identical replay; projection failures do not submit a new decision. Regular earnings and effective rates shown here come from persisted calculation lines, not a second UI wage calculator. Original work evidence and finalized snapshots remain under their existing immutable authorities.

### Priced earning presentation

`payroll_earning_groups` is the private server read projection shared by open and
finalized Review and Draft/Final payslip documents. It sums already-priced daily
amounts; it never reprices summed hours. Compatible code/rate/multiplier/rule,
compensation and other priced basis must match. Mid-period rate/rule changes remain
separate groups. Lines without a time basis remain individual. Gross reconciles
exactly, including original daily rounding. Statutory PH lines use Public Holiday
Allowance; company benefit evidence retains its distinct label. Original lines and
group details remain available under Calculation details. Existing finalized
snapshots and existing PDF artifacts are not rewritten. Newly rendered documents
consume the same server groups with the unchanged Unicode renderer/font assets.

Resolved, non-stale earning lines display even when an independent PH/OT/statutory
issue prevents Run readiness. Pending Gross/Net and finalization gates remain; a
partial earning projection is never represented as final payable totals.

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

The People Payroll UI has four destinations: Overview, Payroll Profiles, Payroll Runs,
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

Run detail has a compact command header with readiness and canonical financial
totals; unresolved totals show `—`. Review Payroll reuses the monthly employee
processing surface (not a competing monetary projection), with Status, Pay Basis,
Workplace and employee search. View opens the existing centered employee review
without changing stages. Blockers precede the statement; compensation, relevant
payable time, financial lines and current read-only Employee bank information
remain available. Bank information is operational context, never a new readiness
or finalization gate. Successful individual decisions/adjustments refresh the
employee result, table and header. Finalize remains under the existing server
readiness gates, with one header action and a count/totals confirmation. Finalized
rows and financial totals consume frozen snapshots only; current Employee bank
information is explicitly distinct from immutable financial evidence.

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
For authorized managers, the shared open-run workflow checks canonical fingerprints on entry, input/read-model refresh and window focus, and automatically recalculates only missing/stale employee results through that same RPC. Compensation, statutory setup, components, rules and work evidence use their canonical fingerprint dependencies; the client never prices contributions. Current unresolved results remain Pending Review and are not retried merely for being unresolved. Failed automatic commands wait for explicit Retry Calculation. Finalized/paid records are snapshot-only; Ready runs require the existing Return to Review transition before recalculation. The Review table presents period-resolved EPF/SOCSO/EIS employee and employer shares and PCB employee share, with N/A, Review and Pending states. Deductions remain the existing total including LINDUNG; Employer Cost uses the canonical total. Bank information remains non-blocking in employee detail.
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

Settings → Public Holidays uses Official Calendar → Select Company Holidays →
Review & Publish. The working geography comes from canonical effective outlet-state
versions through `payroll_holiday_operation_read`; names/addresses and source rows
never supply missing workplace geography. A single-state shared operation defaults
to that state. Multiple-state operations use an explicitly selected workplace;
missing state evidence blocks operational publication with a setup reason.
Only applicable National/State rows enter the normal date-review and selection
workflow. Source-verified dates need no row action. Applicable uncertain,
conditional, changed or missing source entries remain explicit review exceptions.
Explicit date review uses `payroll_holiday_date_confirm`, never a transcription save.
The existing append-only import events record the confirmed date, official reference,
actor/time, canonical geography evidence, captured source hash, stable row identity
and full row-evidence fingerprint. Raw source rows, PDF bytes and prior transcription
history remain unchanged. `payroll_holiday_effective_rows` overlays only matching
confirmations for candidate reads, review, annual/scoped publication and additional
entitlement review. A changed source hash or revised row evidence invalidates the
overlay; old transcription saves never become confirmations. Source warnings remain
in Advanced & History, while normal review shows date/reference and Confirm Date.
Independent jurisdiction, duplicates, paid classification, baseline correction and
additional-entitlement blockers remain enforced after a date confirmation.

Mandatory paid classification remains an explicit employment-law confirmation,
separate from source-date verification. Five mandatory paid holidays and at least
six company choices are shown separately; additional gazetted entitlements remain
outside those six choices. Review shows selected dates, classification and
applicability, with one explicit Publish Year Calendar action.

`payroll_holiday_operation_publish` is an atomic adapter over the existing candidate
review, structured import, annual-calendar and company-policy commands. It checks
actor/permission/outlet scope, verified geography, source revision and baseline,
applicable exceptions, five mandatory classifications and six company choices.
Calendar publication and company selection commit together, with payload-bound
retry identity and an audited source hash, geography evidence and scope. Workplace
selection uses the existing reasoned outlet-policy override; all-workplace selection
uses the existing active-company default command. Unrelated extracted rows remain
unchanged and unreviewed; previously published other-state entries are retained.
The full source candidate is not claimed globally approved/published by a scoped
operation. Its append-only scoped publication event pins the applicable manifest,
while the existing published calendar/policy versions remain Payroll authority.
No new holiday store or Payroll date resolver is introduced. Normal source
maintenance, Imported/Matched/Blocked diagnostics, all-jurisdiction review and
correction tools remain in Advanced & History. The Admin-triggered
`payroll-holiday-updates` Edge Function checks only the approved BKPP annual-calendar
and Act/Gazette directories. It follows actual selected-year PDF links under the
same official storage host, rejects redirects and bounded-response violations,
and captures exact bytes through the existing controlled-import authority.
Content-hash locks reuse existing candidates; private update-check evidence records
the authorized actor, check time, sources and result. A partial fetch never claims
No updates. The trusted checker extracts supported BKPP PDF tables into a Proposed
Holiday Calendar through the existing candidate authority (`bkpp_proposal_v2`).
Text, dates, weekday consistency, complete row order and State-column markers are
validated; image headings require an exact, visually verified source hash. Unsupported
layouts fail closed with a specific manual-review reason. Exact source bytes/hash and
page/row references remain retained. Source dates marked subject to change, conditional
alternatives, changed/missing entries and mandatory paid classification require
explicit review. Clean new source rows are pre-reviewed as source facts only; this
neither publishes the calendar nor confirms paid status. Calendar and company-policy authorities remain separate; the operational adapter
invokes them in one transaction. No scheduled
job exists. Secondary controls share one Advanced & History entry: Official Sources
owns source evidence/import history and Add Official Source Manually; Calendar
Maintenance owns Override Classification and Add Sourced Holiday; History shows
calendar/company-policy versions, publication evidence and historical definitions.
Normal update review and publication remain outside this entry. Manage Exceptions
remains a separate company/outlet business workflow. Operational selection shows five Mandatory paid holidays and six
Company-selected paid holidays and locks
explicitly reviewed required entries; names/jurisdictions never establish required
classification. This operational completeness presentation does not claim
statutory compliance or replace work-date-effective calculation authority.
Additional mandatory paid declarations are a separate entitlement, never inferred
from names or generic gazetted status. The authorized
`payroll_additional_holiday_confirm` command retains the captured source hash,
explicit gazette/employment-law review, jurisdiction, actor/time and retry identity
in append-only `payroll_additional_holiday_confirmations`. New company-policy
revisions pin these `additional_entries` outside the six optional slots. Confirming
an addition atomically advances existing published assignments with unchanged base
selection/scope/calendar; previous revisions and finalized payroll stay immutable.
The work-date resolver applies the pinned addition only in its jurisdiction.
The annual source calendar is not rewritten. Summary separates Mandatory paid holidays,
Company-selected paid holidays, Additional gazetted holidays and Total Paid Holidays; eleven is the base,
not an annual cap. Company Selected displays the selection count and minimum met,
not an x/6 maximum. Corrections need separate reviewed evidence, never source edits.
Manage exceptions can focus one company selection/benefit while default actions
continue applying to all applicable active companies. Source metadata, versions,
QA visibility and history remain secondary. Draft inline selection never advances
published assignment pointers until the explicit Publish action.
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

Official-source ingestion is controlled import, not unattended synchronization.
JPM/BKPP publishes [annual calendars](https://www.kabinet.gov.my/hari-kelepasan-am/)
and separate [special-holiday gazettes](https://www.kabinet.gov.my/akta-dan-warta/).
No verified machine-readable provider exists in the repository. V1 captures an
Admin-uploaded PDF matching an actual official government HTTPS reference.
`payroll_holiday_import_candidates` retains bounded (5 MB) private PDF bytes and
server SHA-256; source reads use authorized RPCs, never public URLs. This low-volume
document boundary has no client table access. A verified structured transcription
supplies actual dates, National/State ISO codes, document page/row provenance and
supported correction/substitution links. `verified_manifest_v1` is a manual
transcription method, not an automated PDF parser or source-certification claim.
Required paid status is not inferred from name or jurisdiction. Existing unchanged
required classification is preserved, not created by the importer.

Capture → Parsed evidence → Needs Review → Approved → Published is backed by
append-only `payroll_holiday_import_events`, server actor/time, payload-bound
capture retries and revision-locked review. Matched records need no repetitive
row review. Machine-verified clean new entries need no repetitive acceptance; manually entered
new entries and changed entries require explicit acceptance. Corrections require
a remark. Missing previous entries must be explicitly retained, never deleted.
Operational classification review shows only unresolved candidate rows, with the
captured source classification, geography and source viewer. Confirm Classification
persists the existing revision-locked candidate decision; it does not publish.
Matched and already-confirmed records are excluded. Blocked or absent classification
evidence cannot be confirmed. Complete-source approval and annual publication remain
separate controlled-import gates. Published classifications display Calendar verified,
not a full-year reclassification form. Individual manual classification maintenance
is under Advanced, requires evidence and a reason retained in the new calendar
revision, and preserves untouched entries and existing required-holiday guards.
Conflicts/uncertainty block approval. Unpublished source rows may be corrected through
the existing parse command; prior extraction/decisions are retained in append-only
events and clean unchanged decisions carry forward by evidence identity. Published
candidates cannot be corrected. A parser upgrade creates a new source interpretation
instead of changing an earlier approved/published interpretation. Supplementary
gazettes cannot replace the annual calendar; their conditional alternatives must be
resolved against official evidence before the existing additional-entitlement command. Complete-source review precedes explicit
publication through the existing `payroll_holiday_calendar_save` authority.
Stale calendar baselines block publication rather than overwriting newer sources.
The source import never advances company assignments or rewrites Payroll/Leave.
Retired candidates are excluded from authoring reads; clearly marked QA candidates
are opt-in and cannot replace a live operational calendar. Source/history remains
retained after retirement. The superseded direct manifest-import modal is removed.
There is no fetch scheduler, scraper, unattended parsing or automatic publication.
Automated official import remains not enabled pending a verified maintained
annual/special/substitute source contract.
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
Non-payable) are seeded. Non-PH premium rates and Monthly ordinary-rate divisor policy are
not guessed: a protected Owner/Admin with Payroll manage authority must publish
a reviewed, sourced rule version. Missing or ambiguous rules leave the employee
in Review Required. Mid-period salary/component changes still require an approved
policy instead of rate blending or silent proration.
Open-run membership is resolved from the People Employment Assignment Timeline
for the payroll period, bounded by the employee's verified Joined Date and
effective employment end evidence. Today's Employee Legal Employer, status,
type, position and workplace are not historical authority. A missing Joined
Date prevents authoritative membership and is surfaced as a run-level Setup
Required condition rather than silently treating an unverified month as payable.
Periods before the 29 September 2026 People cutover remain Review Required;
current Employee fields never backfill that history. A verified mid-period
assignment change that the current Payroll model cannot represent as one
employer/identity also remains Review Required with People revision evidence.

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
  separately. The locked V1 envelope leaves a fractional residual allocation
  Review Required pending authoritative reconciliation; a company accounting
  allocation cannot clear that gate. Existing finalized residual evidence is
  preserved, not rewritten. The same percentage
  treatment applies to the Part A bonus exception when reviewed ordinary wages
  are at most RM5,000 and a reviewed bonus raises monthly wages above it.
  Component bonus/ordinary classifications are append-only, effective-dated,
  source-reviewed versions; an ambiguous threshold stays Review Required.
  EPF excludes overtime, including pay for rest-day/public-holiday work as
  defined in the EPF Act. The supported categories remain bounded to Malaysian
  under-60 and ages 60–74 with reviewed applicability; other categories fail
  closed. Published KWSP examples validate the percentage/total rule, not an
  assumed fractional-residual split.
- PERKESO Act 4 base SOCSO first/second categories, effective October 2024:
  65 bands per category with an RM6,000 ceiling. LINDUNG 24 JAM is a separate
  voluntary, employee-funded non-employment injury scheme for Malaysian
  employees; its election does not change ordinary Act 4 contribution. The
  2026 Act 4 projection therefore does not require a LINDUNG election. It
  remains bounded by reviewed applicability, supported age/citizenship and
  contribution-history categories, and resolved component wage treatment.
  LINDUNG has its own participation and collection authority below; its election
  never changes ordinary SOCSO applicability or contribution amounts.
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
Setup confirmation distinguishes stale information and requires explicit
same-modal Refresh Setup. Settings exposes schedule sources read-only.

### Effective-date contract (2026-09-27)

Pay remains exact-date effective. Initial setup recommends the Employee's
canonical Joined Date, including for existing employees, but writes nothing
until Admin confirms. A later pay start warns about missing earlier pay history.
The independent Effective Payroll Month defaults to the current month (or the
future join month). It is not an inferred historical salary date.

New statutory confirmations append paired applicability/category evidence with
`effective_basis=payroll_month`, first-of-month date and `month_revision` to the
existing version tables. One explicit confirmation covers the eligible payroll
period in that month. Subsequent months inherit it until changed. Same-month
draft changes append a revision; identical reconfirmation is a no-op. All four
scheme applicability choices are required; categories apply only to applicable
EPF/SOCSO/EIS. PCB remains monthly manual amount confirmation, not a category.
Missing supported category evidence remains Setup Required.

Legacy `exact_date` evidence is not backdated, rewritten or silently promoted.
The shared effective selectors prefer an explicitly confirmed monthly event
over legacy dates in the same month; without one, legacy date coverage and its
real gaps remain authoritative. Setup, statutory calculation and PCB reads and
commands use the same selectors. Fingerprints include complete evidence history;
confirmation locks Profile and affected Runs, rejects stale evidence and changes
to finalized periods. Existing frozen snapshots are unchanged.

Recurring definitions own nullable `mid_period_policy`; no existing definition
receives an automatic default. An active assignment without policy blocks with
Component proration policy required. The private canonical recurring projection
resolves exact-date assignment history and pins definition, policy, dates,
employment window and assignment versions in calculation evidence:

- Calendar days: sum effective daily amounts in eligible employment days divided
  by calendar days in the payroll period, rounded once to two decimals.
- Full amount when active: one full amount if active in the eligible period.
  Multiple distinct amounts in that period remain review-required, not guessed.
- Start next full period: use the assignment at the start of a full eligible
  employment/payroll month; intra-month changes apply next full period.

This does not invent allowance entitlement reduction for unpaid leave. Component
statutory treatment applies to the resulting canonical amount. Policy changes
after finalized use require a successor definition. Statements render pinned
formula evidence, never independent UI pricing. Missing pay history includes
its actual date range; two real monthly rates remain unsupported salary blending.

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

## Phase 5 V1 — Draft and Private Final Payslips

Run review is always navigable and projects canonical readiness; Send to Review
and Mark Ready are not separate Admin tasks. One Finalize confirmation delegates
to the existing sequential review/ready/finalized commands, retaining all server
permission, evidence and snapshot gates. A partial failure reloads current Run
state; no client result can authorize finalization. Recalculate Payroll runs the
existing earnings command followed by statutory calculation, stopping on failure.
Manual PCB confirmation remains an independent employee review requirement.

Payroll owns payslips separately from Legal Contracts and Employment Documents.
Finalization captures an immutable payslip identity alongside the existing
financial snapshots. The private `payroll-payslips` gateway renders one A4
artifact per finalized employee/revision from those snapshots, retains manifest
and PDF SHA-256 evidence, never overwrites the object, and issues 60-second
signed access after revalidating the caller. Pre-foundation revisions without
frozen identity fail closed rather than copying today's mutable identity.

Admin uses existing entity-scoped `payroll.view`; opaque Crew sessions derive
the employee server-side and expose only each period's current finalized result.
Crew Me → Payslips has no correction/history surface. Superseded artifacts remain
available to authorized Admin/Audit; a correction creates a separate artifact.
Client roles have no direct payslip table or storage access.

Review Payroll exposes View / Draft Payslip. The entity-scoped Admin-only
`payroll_draft_payslip_read` consumes the latest non-stale calculation and
statutory reads without mutating them. The Edge gateway returns a transient,
no-store PDF marked DRAFT · NOT FINAL; it creates no job, artifact or audit event.
Unresolved statutory totals remain unavailable, not zero. Correction drafts
use the same boundary. Finalized rows expose View / Payslip.

One Payroll-owned A4 renderer and document contract serve Draft, Final, Admin
and Crew. Final documents use only immutable snapshots. New finalizations also
pin employee Position; older evidence is never backfilled from current masters.
Existing immutable artifacts retain their original bytes/hash/layout.

The corporate A4 layout (a4_v4 for new artifacts) shows the canonical employer
registered address and full Employee `ic_no` (IC/passport), Position and Pay
Basis. Draft reads current canonical identity; new Final identity snapshots
capture these fields at Finalize. Older frozen identity is not backfilled from
mutable masters; missing identity fields display neutrally. Employee code and
workplace remain technical evidence, not displayed document fields. Draft and
Final share the layout, with Draft-only status/watermark and a minimal private
document/page footer. No financial or font-shard authority changes.

Payment/Settlement is deferred. Earlier Staging append-only settlement evidence
is retained, but client command privileges and runtime controls are removed.
Bank Info remains an Admin preparation read, not a Payroll readiness gate.

## Deferred

### V1 release hardening

Calculation, readiness and Finalize use `payroll_run_employee_ids` for the same
period membership. Finalized membership resolves only from frozen profile
snapshots, never today's employment/profile eligibility. Missing Legal Employer
blocks profile creation; missing Joined Date remains unresolved, not inferred.

For open runs, one private Payroll-period employment resolver consumes People
as-of revisions and supplies membership, calculation fingerprint/review issues,
Run review identity and Draft Payslip identity. Later People corrections make
open calculations stale; Admin must refresh them. A future assignment does not
affect an earlier period. A new Finalize pins period-resolved identity, while
previously finalized membership, identity, statutory evidence and private Final
Payslip artifacts remain immutable. Payroll still owns pay basis, compensation,
payable time, statutory results and correction commands; Employment Type does
not imply a salary or pay basis.

Overview and Run Review share the read-only `payrollRunPresentation` projection
and run-keyed `usePayrollRunRead` loader. Financial authority stays server-owned;
stale async successes and failures cannot replace another Run's evidence.

Unicode rendering uses release-prepared static font shards in the private
`payroll-renderer-assets` bucket. Preparation preserves every mapped character
from the repository Noto source; the release manifest maps characters to
content-addressed, size/hash-verified assets. Only required shards are loaded and
embedded without request-time subsetting or full variable-font processing.
Characters outside source coverage fail closed rather than disappearing. Upload
the repository prepared assets before the gateway release. No upstream font
fetch occurs at runtime. Draft and Final retain one canonical layout/projection;
previous immutable artifact bytes remain unchanged. Operational render timings
contain no employee identity, financial values, token or document content.

The local-only migration rehearsal script lists the exact ordered manifest and
the equivalent Staging ledger timestamps. Applied history is not renamed or
replayed to reconcile ledger identifiers. Dormant settlement functions, reserved
PCB compatibility fields and live `pre_*` lifecycle helpers remain intentional
compatibility debt; they are not permission to expose those features in V1.

Payment/Settlement, bank transfers/payment files and Finance projections remain deferred.

### Historical statutory setup presentation

Profile readiness describes current setup only; it does not establish historical
Payroll readiness. Review distinguishes absent applicability coverage from an
effective legacy record whose scheme applicability is still null. Unconfirmed
applicability directs Admin to the existing Manage Statutory Setup command and
the historical Effective Payroll Month. Explicit confirmation appends paired
monthly evidence, preserves later setup and audit history, and remains subject
to the existing finalized-period guard. Refresh an open Run afterward; PCB
amount confirmation remains independent. Never infer an earlier month from
current confirmed categories or silently backdate a record.


## LINDUNG 24 Jam V1 (SKBBK)

Payroll owns LINDUNG as an independent effective-dated statutory component. It
is not inferred from SOCSO applicability and is never merged into SOCSO Employee.
The regulatory basis is PERKESO's August 2026 FAQ and official Act 4 contribution
schedule including SKBBK:

- https://www.perkeso.gov.my/images/lindung/lindung-24-jam/130826-FAQ%20_LINDUNG24Jam_EN_version.pdf
- https://www.perkeso.gov.my/images/lindung/lindung-24-jam/NewContributionRateIncludingSKBBK.pdf

`payroll_lindung_participation_versions` is append-only, RLS protected and has no
client table grants. `payroll_lindung_setup_read/confirm` enforce the existing
Payroll identity, permission, employee and designated-employer scope authorities.
Confirm locks the Profile, checks an evidence fingerprint, derives the Admin and
records a retry-safe request, superseded monthly revision, source/reference,
reason, covered worker facts, designated employer and effective date/time.

Participation statuses are Mandatory, Participating, Valid Opt-Out, Another
Designated Employer and Unresolved. Covered foreign workers require Mandatory
participation (or another designated employer), with explicit covered-employment /
passport/work-pass evidence. Permanent/temporary residents require explicit
resident evidence. No employee histories are seeded or inferred. Evidence starting
in September does not establish June–August participation.

June 2026 requires its own mandatory-period evidence; a later opt-out does not
cancel it. June local mandatory evidence does not prove local participation from
July onward. Local opt-out records a valid PERKESO notice; July–August transition
notices and newly registered locals before their first deduction are supported.
Opt-out requires confirmation that the employee is not receiving LINDUNG benefits.
Confirmed continuing participation after August and rejoin follow Once In, Always
In. Rejoin requires prior recorded opt-out and the exact PERKESO submission time;
that salary month's full contributable wages apply without day proration.
Designated-employer changes require one of the official grounds and sourced
PERKESO evidence. Another designated employer resolves to no deduction here,
without asserting that the worker is exempt from the scheme.

The official Phase 1 pack is effective 1 June 2026–31 May 2028, with 65 exact wage
bands and RM6,000 ceiling (maximum employee amount RM44.65). The corresponding
First/Second Category SKBBK employee columns agree. No percentage approximation is
used. No Phase 2/3 table is installed; a required deduction outside a verified
pack fails closed. Later effective-dated packs can be added to the same schedule
authority without modifying earlier reference rows.

LINDUNG independently evaluates pinned earning lines under Act 4 section 2(24),
including overtime/rest-day/holiday pay and subtracting unpaid-time wage reductions.
The existing component `socso_treatment` is the shared Act 4 wage-inclusion policy,
not a SOCSO deduction output; its resolved treatment and component evidence are
pinned separately for LINDUNG. Annual bonuses, travel allowances, employment
expense reimbursements and termination/retirement gratuities must be excluded
under that policy. Unknown component treatment blocks readiness. Zero payable
wages yield zero contribution; positive wages use exact official schedule bands.
Employer LINDUNG amount is zero; only the employee deduction reduces Net Pay.

Manage Statutory Setup has a distinct LINDUNG evidence section for the selected
contribution month. Current Profile readiness is distinct from historical coverage.
Run preparation and statutory readiness consume the same resolver, with actionable
missing-participation, designated-employer, wage-treatment and pack reasons. Review
and Draft/Final Payslips show a separate LINDUNG 24 Jam employee deduction and no
employer LINDUNG line. Existing Unicode/PDF rendering remains shared.

Finalize pins the full participation revision, designated employer, assessed wage
lines/base, official pack/version, band and amount in the existing statutory
snapshot. Finalized reads consume that snapshot. Later setup cannot rewrite final
records or PDFs; setup affecting finalized periods requires an open governed
correction. Corrections freeze new evidence while preserving the previous revision.
The separate People employment-history/cutover gate is unchanged.

### Unified effective-dated statutory setup

Manage Statutory Setup confirms ordinary statutory setup and LINDUNG atomically through the extended `payroll_statutory_setup_confirm` authority. Existing initialization callers retain their seven-argument contract. Worker coverage derives from canonical nationality when known; verified resident evidence remains explicit. Coverage status is the primary LINDUNG input. Routine coverage inherits Effective Payroll Month and the dated employment employer; opt-out/rejoin retain their legally required notice/submission date and time. Optional notes do not replace required PERKESO transition evidence. The server records actor, timestamp, month and transition reason automatically.

An unchanged resolver-verified participation revision can be retained for the selected month without creating another notice or audit revision. Later evidence cannot prove an earlier month. New combined writes share one transaction, request identity and stale-read checks; failed LINDUNG validation leaves ordinary setup unchanged. Calculation packs, resolver semantics, finalized snapshots and the People pre-cutover finalization gate remain unchanged.

### Targeted LINDUNG validation

Manage Statutory Setup uses a read-only, manage-scoped `payroll_lindung_setup_preview` before the atomic Save. Preview and confirmation invoke the same private regulatory validator and intent normalization. Only missing transition facts are disclosed under Additional information required; applicable earlier recorded supporting evidence may be reused, never later evidence for an earlier month. Mandatory coverage is resolved from the worker/month rules. Preview does not write participation or audit evidence and cannot authorize Save; confirmation revalidates scope, stale evidence, chronology and finalization under its existing transaction locks.

### Explicit monthly non-applicability

Admin may explicitly confirm LINDUNG Not Applicable for a local employee/month through the existing atomic statutory setup authority. It is distinct from regulated opt-out, requires no participation, notice or designated-employer evidence, and resolves readiness with zero deduction. It is not derived from ordinary statutory applicability. The verified state carries forward from its effective month until a genuine later status change; it cannot establish earlier coverage. Existing June/foreign mandatory restrictions, participation transitions, audit history, finalized correction guard and rate packs remain unchanged.

### Continuing coverage and unified Statutory History

Verified LINDUNG revisions, including Not Applicable, remain effective until superseded by a genuine verified revision. Unresolved is absence-of-confirmation evidence: it remains immutable and audit-visible but is excluded from effective resolution and prior-transition validation. New Unresolved submissions cannot replace currently valid verified coverage. June mandatory local coverage still does not prove a July election, and identity/employer/pack validation can still require review. A historical verification cannot establish earlier months. Legacy unresolved interruptions covered by a subsequently recorded historical verification receive a system audit annotation; their original rows and all finalized evidence remain unchanged.

Manage Statutory Setup presents one shared Effective Payroll Month above five Statutory Coverage rows and one Confirm Statutory Setup action. LINDUNG worker context and status-specific disclosures live in its row; there is no second month/save/history workflow. Historical guidance appears only after an intentional earlier-month selection with missing coverage. Statutory History composes the existing authorized statutory and LINDUNG reads at relevant revision/boundary dates; all five resolved states are chronological, with separate backend evidence available only under Audit details. This read model does not recalculate or rewrite finalized Payroll.

### Former employees and historical compensation

Payroll Profiles includes scoped employees with a current Legal Employer, a
Payroll Profile or historical employment employer evidence. Employment status
and the known effective end date are displayed separately from pay/statutory
readiness. Historical employer associations support profile discovery only;
open and finalized Run membership still use the existing canonical period
employment and frozen membership authorities.

`payroll_compensation_adjust` accepts explicit historical effective dates and
appends corrections at the same date using a server-assigned revision. Original
rows and later effective dates remain unchanged. Effective consumers select the
latest revision at each date; ID-based pricing and existing finalized snapshots
retain the original evidence. The affected interval ends at the next genuine
pay effective date; finalized periods in that interval remain protected. Dated
People evidence supplies employer/workplace where available without reactivating
or editing employment. Reason, actor and revision linkage are retained in Payroll
audit events.

Open employee Run review exposes Set up pay when period compensation is missing.
It opens the same compensation form/command as Profiles, scoped to the employee
and payroll period with an explicit editable pay date. Saving refreshes canonical
stale calculations through the existing automatic flow and retains the Run and
employee review. Pay-only initialization leaves statutory applicability
unresolved until separately confirmed; it does not infer participation or
broaden membership.

### Payable Time decision latency and recovery

`payroll_time_decision_save` appends the authorized date decision and its request-bound audit in one short transaction. It returns the canonical saved row and history. It does not calculate the whole pay period inside that transaction. The changed time-version identity already invalidates the existing calculation/statutory fingerprints; no second money or invalidation authority is introduced.

Sequential Review applies that committed row to its retained queue immediately. While the reviewer handles the queue, whole-run refresh/focus reads are suspended and affected employees are marked stale in the presentation. Closing or finishing the queue automatically coalesces recalculation before refreshed financial projections; stale amounts are hidden and calculation updates are explicit. Required PH/statutory evidence remains Pending Review and calculation failures use the existing Retry Calculation recovery. Reopening a run uses the same server fingerprint checks. Finalized/paid evidence is never recalculated through this workflow.

SQL cancellation rolls back both the decision and audit. An ambiguous transport response is resolved by `payroll_time_decision_status` against actor, exact request fingerprint and authorized run/employee scope, then an identical idempotent replay if needed. Unknown outcomes lock the submitted intent and require Verify / Retry Decision before navigating away; retries never use a different payload with the same request ID. Run locking, the unique audit request index, latest-version checks, correction reasons and original evidence remain enforced.

Date-effective compensation reads filter the canonical versions by profile before selecting latest effective date/revision, rather than materializing all employees through the global set function. This preserves corrected-date and historical version semantics and uses the existing compensation indexes.
