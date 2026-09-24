# Crew Operations

## Purpose And Scope

This domain owns operational tasks and Daily Operations, task schedule/assignment/completion, Cash Checkout, Floating Cash, Deposit Ledger, and cash Handover.
It covers the daily execution layer used by outlet Crew and supervising Admins.

## Canonical Ownership

Current task, operations-template, daily-instance, cash-checkout, collection/handover, deposit-ledger, RPC, RLS, and contract tests are authoritative.
Crew Workforce owns employee access, roster, attendance, and leave.
Crew Localization owns translated content state and fallback behavior.

## Core Entities

- Task and Daily Operations templates, schedules, assignments, instances, and completion evidence
- Outlet/date/position and roster-derived execution context
- Cash settings, effective Floating Cash, immutable float adjustments, and tolerance rules
- Daily Cash Checkouts, denomination evidence, variances, reviews, and retained/deposit amounts
- Cash collections or handovers, receiver confirmation, deposit ledger entries, corrections, and receipt evidence

## Lifecycle And Business Rules

Published or active task definitions create scheduled operational work according to current assignment rules.
Crew receives only work applicable to its validated session, outlet/date/position context, and assignment. An unfinished personal Task may be redone only through the token-bound reset authority: it clears current response rows, returns the assignee to not started, and appends reset evidence without changing the frozen Task definition, assignment, or existing audit history.

Platform Notification V1 consumes canonical Task occurrences, never recurring templates. A scheduler-owned, Malaysia-time projection creates one deterministic actionable notification per occurrence/assignee, important for one-off work and normal for recurring work. It separately creates exactly-once due-soon and overdue reminders only while the assignee remains incomplete; completion suppresses future reminders. A material assignment, availability, due-time, or cancellation change to an actionable occurrence may produce an important change notice. Notification delivery/read never starts, saves, resets, or completes a Task.
Completion and review transitions are server-controlled and preserve required evidence.
Crew All Tasks History is a token-bound, fixed 30-calendar-day execution projection; it cannot widen the Crew query window and does not alter Admin's full task audit history. Crew Task Detail projects responsibility from the frozen instance assignment and completion actor/time from immutable response evidence, without changing Task assignment or completion authority.

Cash Checkout is an outlet/date lifecycle with controlled draft, submission, review, completion, and canonical calculation states.
The server calculates opening expectation, counted totals, variance, retained float, carry-forward, and amount for deposit.
Floating Cash changes require authorized settings workflow and immutable adjustment evidence.
Cash Checkout settings are outlet-scoped. Eligible checkout positions are configured by canonical Job Position IDs; the server retains derived position names only as compatibility input for the employee master, which currently stores position names. The effective Floating Cash value comes from the latest applicable immutable adjustment, while each checkout snapshots its Floating Cash and variance tolerance so later settings changes do not rewrite history.
Variance tolerance and the review-over-tolerance switch control server-calculated review state. Internal receiver confirmation controls both Crew- and Admin-created handovers; when disabled, an internal handover completes without a pending acknowledgement while still posting only one ledger debit. Closing deadline is currently stored and exposed as operational reference but does not gate or transition Cash Checkout; future enforcement requires an explicit lifecycle contract.
Crew Checkout History is a bounded, outlet-scoped read projection of completed Cash Checkout snapshots from the requested business date's preceding 30 calendar days; it never derives history from Deposit Ledger entries.

The Deposit Ledger is append-only financial evidence derived from completed obligations, submitted collections, deposits, and explicit corrections. A submitted collection immediately posts its single debit; recipient confirmation is acknowledgement evidence and never posts a second debit.
Internal handover remains pending confirmation until the intended receiver confirms through a valid Crew session. Cash Handover initiation requires the active, outlet-scoped Crew Access capability, independently of Admin roles and receiver eligibility. New handovers use one canonical `Cash handover` purpose because all follow the same collection, confirmation, ledger, and accounting lifecycle; historic purpose text remains preserved as submitted evidence. New handovers may be addressed only to an active, outlet-scoped Crew account explicitly configured by an Admin as a Cash Handover Receiver; receiver configuration is versioned and audited, while removing a receiver never rewrites or strands existing assignments.
Corrections cannot silently rewrite completed checkout or ledger history.

Crew Admin Tasks, Manager Review, Daily Cash Checkout, and Cash Deposit Ledger use server-paged read projections (20/50/100 rows). Scope, date, search, and lifecycle filters apply before pagination; the Deposit Ledger's page is independent from its canonical append-only balance summary. Crew Cash projections resolve actor display through the canonical `employees` identity: Crew uses its employee name and Admin uses its People/Admin employee name. If no human display identity exists, the projection returns the safe `Admin` label; it never projects a raw auth email. Immutable employee/auth actor IDs remain stored audit evidence and are never rewritten for presentation.

## Permissions, Snapshots, And Audit

Admin task and cash actions require the relevant Crew Operations permission plus outlet scope.
Crew mutations are token-bound to the current employee and eligible work.
Published task/content versions, completion evidence, cash calculations, float adjustments, handover confirmations, and ledger entries retain immutable or append-only history.

## Admin And Crew Workflows

Admins create and publish operational templates, monitor daily execution, review exceptions, configure outlet cash rules, review Cash Checkouts, coordinate collections, and inspect the Deposit Ledger.
Crew view assigned daily work, complete tasks with required evidence, perform eligible Cash Checkout steps, and confirm assigned handovers.
Crew Home also exposes an Operations entry for Restaurant Stock Check and Purchase Orders when the selected outlet has corresponding Special Access. This is an execution surface, not a Daily Task projection: it consumes Restaurant Inventory's token-bound attention, read and lifecycle commands. Fixed-outlet Crew use their workplace outlet; Management must select a Role-authorized outlet and hold each outlet-specific Special Access independently. Inventory screens remount on outlet changes so prior outlet state cannot remain actionable.

## Integrations

Crew Workforce provides secure sessions and roster-derived context.
Crew Localization supplies translated task snapshots and fallback behavior.
Crew Learning may supply SOP references or required knowledge but does not own task completion.
Crew Performance may consume controlled completion and cash evidence without mutating operations history.
Restaurant Finance may consume summarized cash evidence without owning the Crew cash lifecycle.

## Compatibility And Deferred Scope

Legacy task or operation-template route names resolve to this domain's canonical owners.
Tasks and Cash Checkout remain grouped because both are outlet daily execution lifecycles; their entities and permissions remain distinct.
Bank API integration, automated deposit matching, and payroll deductions are deferred unless explicitly introduced.
