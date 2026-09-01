# Crew Performance And Reward

## Crew Mobile Explanatory Help

Crew Mobile uses the shared `CrewHelpTrigger` and `CrewHelpSheet` primitives for explanatory, non-mutating help. Pages provide only title, body, and optional structured content; the helper owns the one-layer icon treatment while `CrewBottomSheet` owns accessible bottom-sheet behavior, focus handling, backdrop close, and reduced-motion presentation. Selectable action flows may reuse the shell without adopting the helper content model. Operation, confirmation, and error dialogs remain owned by their existing workflows.

## Purpose And Scope

This domain owns Crew Growth, Performance, monthly evidence and scoring, Reward cycles and payout logic, and the operational outcome of skills or certification.

## Canonical Ownership

Current growth, performance, evidence adapter, review, reward-cycle, payout, certification, RPC, RLS, and contract tests are authoritative.
Source domains retain ownership of roster, attendance, task, cash, and learning evidence.

## Core Entities

- Growth profiles, goals, skills, and development evidence
- Performance periods, evidence, scoring inputs, reviews, decisions, and finalized outcomes
- Feedback or moderation evidence where included by current contracts
- Reward cycles, eligibility, calculated awards, approval/finalization, and payout evidence
- Certifications or skill outcomes derived from controlled qualification evidence

## Lifecycle And Business Rules

Monthly Performance uses defined, private evidence adapters rather than reading mutable page state.
The server derives protected scoring, eligibility, and reward values from canonical evidence and configured rules.
Reviewers may add permitted assessment evidence or decisions but cannot rewrite source-domain history.
Current mutable Service Standards reviews contain Welcome / Greeting, Thank You / Goodbye, Grooming, Work Area Cleanliness, and Guest Interaction. The server requires that exact current set and derives the observed-criterion denominator; retired Initiative evidence remains only in prior review snapshots for audit. A finalized Performance period rejects new review evidence and remains immutable.

For a Crew member's current mutable Performance, the token-bound Reward read model may expose a clearly marked, non-persistent Estimated Reward only when a usable draft score exists. That display projection reuses the canonical Reward Pool × eligible-hours share × Performance earn-rate formula over frozen campaign participants and live eligible hours; it never writes a Reward entry, creates a payout snapshot, or changes campaign state. Missing Performance scores remain a waiting state. Finalized and paid Reward entries remain the sole authority for final or paid amounts and historical payout records.

A Reward Campaign is finalizable only after its frozen participant set has a current complete calculation and every participant has a legitimate final Reward outcome: `qualified` or a documented non-payout `not_eligible` result. Missing, uncomputed, malformed, or `awaiting_performance` entries are payout-critical blockers. The trusted finalization authority locks and evaluates this readiness atomically before any entry/cycle mutation; the scoped Admin read model exposes only a human-readable readiness projection for review. Existing finalized and paid Campaigns are immutable historical evidence.

Customer Feedback preserves each guest submission as evidence while independently controlling its scoring eligibility. It owns `crew`, `food`, and `outlet` scope: only Crew feedback is attributed to an employee, may be included or excluded through an audited server authority, and is eligible for the Performance customer component. Food and outlet feedback remains unassigned, has no scoring controls, and is never consumed by Crew Performance or Reward. Crew attribution remains one-to-one in the current phase; corrections use canonical Crew identifiers, retain prior/new attribution and reason in append-only audit history, and may refresh only mutable Performance results. Finalized Performance and Reward outputs remain immutable.

Public guest feedback uses an outlet-scoped opaque `public_feedback_token`, not an outlet UUID, at `/feedback/<token>`. Guests choose Crew Member, Food & Drinks, or Overall Visit before submitting experience, scope-specific canonical tags, and an optional comment. The public resolver returns only the outlet display name and eligible recent/on-shift Crew; token submission resolves the outlet server-side and applies scope validation, dedupe, request-hash, evidence insert, and a Performance refresh only for Crew evidence. Legacy `#feedback?outlet=<uuid>` links remain supported and normalize to the token URL after resolution. Admin Customer Feedback provides the selected outlet's QR, stable public link, copy action, local QR download, and a scope-aware evidence table without creating a separate Admin page.

Draft or open periods may evolve through controlled workflows.
Finalized scores, approved reward outcomes, and payout evidence are immutable or superseded through explicit correction authority.
Rule or weight changes must not retroactively alter finalized periods unless a deliberate recalculation contract exists.

Learning completion may qualify a Crew member for a skill or certification.
Learning owns the source completion; this domain owns the resulting operational qualification state and its performance/reward consequences.

## Permissions, Snapshots, And Audit

Admin access requires the relevant growth, performance, review, reward, or payout permission plus required scope.
Crew reads are token-bound and limited to the employee's own safe results and actions.
Evidence snapshots, finalized scoring, review decisions, reward calculations, approvals, corrections, and payout state retain audit history.

Customer Feedback Detail is the canonical Admin evidence view for submission content, current scoring state, moderation history, and attribution correction history. The operational table keeps excluded feedback visible; period KPIs are scoped to the selected outlet and period rather than table search filters.

## Admin And Crew Workflows

Admins configure or initiate periods/cycles where supported, review evidence, moderate feedback, finalize outcomes, manage certifications, and control reward approval or payout transitions.
Growth Overview is the canonical Admin operational surface for Crew skill progress and actionable certification review. Standalone Certification Review navigation is retained only as a compatibility route into Growth Overview; it must not become a second review workflow or mutation authority.
Crew view permitted growth, performance, certification, and reward outcomes and provide allowed input without controlling final calculations.

## Integrations

Crew Workforce supplies roster and attendance evidence through controlled adapters.
Crew Operations supplies task, Daily Operations, and cash evidence where explicitly included.
Crew Learning supplies completion, quiz, skill, and certification qualification evidence.
People/RBAC supplies identity, permission, and outlet scope.

## Compatibility And Deferred Scope

Legacy Growth People, Performance Reviews, and Reward Cycle routes are compatibility entries into this domain.
Growth, Performance, and Reward remain one bounded domain because they share evidence-to-outcome lifecycles, while their state machines stay distinct.
Payroll disbursement, tax treatment, and external benefits integration are deferred unless current contracts introduce them.
