# Crew Workforce

## Purpose And Scope

This domain owns Crew Access, Duty Roster, Attendance, Leave, balances and entitlement, and roster-derived workforce context.
It connects the employee master record to a secure Crew mobile identity and scheduled workforce evidence.

## Canonical Ownership

Current Crew access, roster, attendance, leave, entitlement, session, RPC, RLS, and test contracts are authoritative.
People/RBAC owns the employee master record and Admin identity.
Crew Operations consumes workforce context but does not own roster or attendance history.

## Core Entities

- Crew Access records, passcode credentials, sessions, failures, and revocation state
- Roster weeks, shifts, drafts, publication revisions, and pinned employee views
- Attendance events, geofence evidence, exceptions, and shift context
- Leave types, policies, entitlements, balances, requests, approvals, adjustments, and projections
- Employee, home-outlet, scheduled-outlet, position, and employment-state references

## Lifecycle And Business Rules

Crew Access is a one-to-one extension of an eligible employee and remains separate from Admin access.
For ordinary outlet Crew, Employee Master workplace scope remains the fixed canonical outlet authority: Crew Access mirrors its resolved outlet, and a workplace transfer updates that mirror, revokes active Crew sessions, and appends audit evidence. A request with a stale or mismatched Crew Access outlet fails closed. For an active employee whose Workplace is Management, Crew Access retains a null primary outlet; the active Role's existing `all` or `selected` outlet scope supplies the operational viewing set, while `none` supplies no Crew operational access. Selecting an outlet never changes Workplace, employee identity, or assignment.
Passcodes are protected, sessions are opaque and revocable, and sensitive requests revalidate token validity, access state, employment state, and the current canonical outlet scope.
The Crew browser keeps only the opaque session envelope locally. Its employee-scoped read projections are cleared and pending reads invalidated on logout or session replacement; a response is accepted only for the current token and refresh generation, preventing a prior employee's data from appearing in a newer session.
Only the server's explicit invalid-session/access response may clear that local envelope and return Crew to sign-in. Offline, timeout, transport, and other transient bootstrap failures preserve it and use the shared recovery flow; browser reconnection revalidates the same token without resetting the Crew route or employee context.
Crew-scoped operational capabilities, including Cash Handover initiation, Asset creation, Asset adjustment, and Asset inspection, are owned by the employee's active Crew Access record and fixed outlet rather than by selected viewing context. Their changes use the controlled Crew Access administration path and retain audit evidence. Asset creation, adjustment, and inspection are independent grants; any one exposes the minimum-safe Assets read surface for ordinary Crew. Management's role outlet set permits only the dedicated read-only Asset projection in this phase, even if historical Special Access flags exist. Creation is limited to a new outlet asset and an initial photo, not ongoing asset administration.

Management Crew Phase 1–2 keeps identity, context and eligibility distinct. `crew_outlet_scope` derives the authorized active-outlet set from the current employee Role; each Management outlet-scoped read validates its outlet parameter again on the server. The client remembers a selected outlet per employee, revalidates it on startup/focus/switch, and invalidates only outlet-scoped reads when it changes. Home task context uses a non-materializing read-only projection; selected-outlet SOP Library is published-reference-only and creates no assignment or acknowledgement; Assets are read-only. Personal roster, Attendance, Leave, Onboarding progress, Growth, Performance, Reward, Notifications and People records remain employee-global. Management Leave reads existing employee-owned history and balances without creating an entitlement from operational context; a new application requires an actual employment outlet. Growth/Performance/Reward retain their existing employment attribution and may be unavailable without one. Clock In/Out still requires an actual published working shift, not an outlet selection. Existing fixed-outlet Crew behavior remains unchanged. Notification destination outlet is resolved from the live source record, never from its snapshot.

Draft Duty Roster weeks are editable by authorized Admins and are not Crew-visible.

Platform Notification V1 consumes, but does not own, workforce lifecycle events. A first roster publication may deliver a normal notice to affected active Crew; a later immutable publication revision compares published entries and delivers important notices only to affected Crew, including additions, changes, and removals. Short-notice schedule changes retain the same priority with concise context. Approved/rejected leave review may deliver a normal notice. Notification reads never change leave or roster state.
Publishing atomically creates an immutable Crew-facing revision for one outlet week. Later Admin edits keep the period Published with unpublished changes; Crew continues consuming the prior revision until Republish atomically promotes the latest working snapshot, including removals.
Multi-outlet scheduling validates both operational and employee scope where current contracts require it.

Attendance is recorded through token-bound server authority. Clock-in stores the current published working-roster entry, publication, start/end time, and publication timestamp as schedule evidence; later roster edits cannot silently rewrite that clock-in evidence. Approved leave and non-working roster entries remain non-attendance days.

Attendance managers may record a reason-required, outlet-scoped Performance exception for an attendance record only through `crew_attendance.manage`. Approved corrections and verified system outages are auditable, may be revoked with a reason, and refresh mutable Performance only. Location verification exceptions remain attendance evidence and do not themselves create a Performance deduction.
Location verification, when enabled for an outlet, uses canonical outlet configuration and preserves original evidence and exceptions.
Clock-out safety and exception behavior follow current RPC contracts rather than client inference.

Attendance history is an outlet/date-scoped server-paged Admin projection. Employee, position, and evidence-status filters are evaluated by the read authority before its authoritative count and page are returned.

Crew Access, Leave Requests, and grouped Leave Balances use separate outlet-scoped server-paged Admin projections. Crew Access search and employment-status scope, and Leave search and applicable lifecycle filters, execute before the authoritative count and page are returned; balance paging does not change the canonical entitlement or calculation authority.

Crew Dashboard is a permission-aware, outlet-scoped daily operational projection. It summarizes published roster attendance, approved leave, today’s task instances, and a next-30-day timeline of birthdays, approved leave, and verified compliance expiry where the current Admin may view those authorities. Its bounded staffing rows expose only published shift timing and the current attendance/leave state; its bounded task rows expose current task occurrences and their authoritative status. Its deterministic operational brief and prioritized attention items deep-link to their owning workflows; it intentionally does not create a cross-domain activity log, duplicate lifecycle, or mutate source evidence.

Leave balances are server-derived from policy, entitlement, approved usage, pending reservations, adjustments, carry-forward, and expiry evidence.
Request, approval, rejection, cancellation, and adjustment transitions must preserve balance integrity and audit history.
Roster projections may display approved leave without transferring leave ownership to the roster.

## Permissions, Versions, And Audit

Admin actions require workforce permissions and all relevant outlet scopes.
Crew reads and mutations are token-bound to the current employee and minimum safe payload.
Roster publication revisions, original attendance evidence, leave decisions, and balance adjustments remain immutable or append-only.

## Admin And Crew Workflows

Admins enable/reset/disable Crew Access and configure per-account Crew capabilities through the separate Special Access workflow; those capabilities are not Admin roles. They also prepare and publish rosters, review attendance evidence, configure leave policy/entitlement, and decide leave requests.
Crew sign in separately, view their own published schedule, clock in/out, review their attendance, change passcode, and manage their own leave requests and balances. Crew with Asset Special Access can open Me > Work > Assets for its current canonical outlet; the Asset domain retains all lifecycle, inspection, evidence, and audit authority.
Crew may also replace its own profile photo through the token-bound profile-photo authority. Employee Master retains the canonical photo reference, while private Storage delivery remains server-scoped and short-lived; Crew does not receive a cross-employee profile mutation path.
Crew Me groups People-owned records under Employment Records: Contracts & Letters, Food Handling Compliance, and Warnings & Notices. This is information architecture only. Employment Contracts remain People-owned immutable document acknowledgements, Food Handling Compliance retains its verification lifecycle, and Disciplinary retains its receipt/response lifecycle. Each authority independently derives employee identity from the opaque Crew session.

## Integrations

People/RBAC supplies employee identity, employment state, Admin permission, and outlet scope.
Crew Operations consumes scheduled outlet/time/position context for task assignment and daily operations.
Crew Performance consumes private roster and attendance evidence through defined adapters.
Crew Learning may use employee eligibility and assignment context without owning workforce state.

## Compatibility And Deferred Scope

Legacy Restaurant Duty Roster routes are compatibility entries into Crew Workforce ownership.
Withdrawn availability and shift-swap experiments are not current product scope.
Payroll, overtime calculation, biometric verification, and automatic labor optimization remain deferred unless current contracts introduce them.
The current Employee Master workplace-to-outlet resolver remains a temporary Phase A compatibility relationship. Replacing it with an explicit UUID employee-outlet assignment is deferred Phase B work and must preserve the fail-closed Crew session boundary.
