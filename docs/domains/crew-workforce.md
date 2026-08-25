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
Passcodes are protected, sessions are opaque and revocable, and sensitive requests revalidate access and employment state.

Duty Roster drafts are editable by authorized Admins.
Publishing creates an immutable revision for Crew consumption; later draft edits do not replace the last published view until republished.
Multi-outlet scheduling validates both operational and employee scope where current contracts require it.

Attendance is recorded through token-bound server authority.
Location verification, when enabled for an outlet, uses canonical outlet configuration and preserves original evidence and exceptions.
Clock-out safety and exception behavior follow current RPC contracts rather than client inference.

Leave balances are server-derived from policy, entitlement, approved usage, pending reservations, adjustments, carry-forward, and expiry evidence.
Request, approval, rejection, cancellation, and adjustment transitions must preserve balance integrity and audit history.
Roster projections may display approved leave without transferring leave ownership to the roster.

## Permissions, Versions, And Audit

Admin actions require workforce permissions and all relevant outlet scopes.
Crew reads and mutations are token-bound to the current employee and minimum safe payload.
Roster publication revisions, original attendance evidence, leave decisions, and balance adjustments remain immutable or append-only.

## Admin And Crew Workflows

Admins enable/reset/disable Crew Access, prepare and publish rosters, review attendance evidence, configure leave policy/entitlement, and decide leave requests.
Crew sign in separately, view their own published schedule, clock in/out, review their attendance, change passcode, and manage their own leave requests and balances.

## Integrations

People/RBAC supplies employee identity, employment state, Admin permission, and outlet scope.
Crew Operations consumes scheduled outlet/time/position context for task assignment and daily operations.
Crew Performance consumes private roster and attendance evidence through defined adapters.
Crew Learning may use employee eligibility and assignment context without owning workforce state.

## Compatibility And Deferred Scope

Legacy Restaurant Duty Roster routes are compatibility entries into Crew Workforce ownership.
Withdrawn availability and shift-swap experiments are not current product scope.
Payroll, overtime calculation, biometric verification, and automatic labor optimization remain deferred unless current contracts introduce them.
