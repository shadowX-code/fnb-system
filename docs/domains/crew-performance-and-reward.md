# Crew Performance And Reward

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

Draft or open periods may evolve through controlled workflows.
Finalized scores, approved reward outcomes, and payout evidence are immutable or superseded through explicit correction authority.
Rule or weight changes must not retroactively alter finalized periods unless a deliberate recalculation contract exists.

Learning completion may qualify a Crew member for a skill or certification.
Learning owns the source completion; this domain owns the resulting operational qualification state and its performance/reward consequences.

## Permissions, Snapshots, And Audit

Admin access requires the relevant growth, performance, review, reward, or payout permission plus required scope.
Crew reads are token-bound and limited to the employee's own safe results and actions.
Evidence snapshots, finalized scoring, review decisions, reward calculations, approvals, corrections, and payout state retain audit history.

## Admin And Crew Workflows

Admins configure or initiate periods/cycles where supported, review evidence, moderate feedback, finalize outcomes, manage certifications, and control reward approval or payout transitions.
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
