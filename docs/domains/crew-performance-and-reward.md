# Crew Performance And Reward

## Google Reviews Foundation

Google Reviews is a separate Admin reputation workspace under Performance. It owns future Google Business Profile connection, verified account/location discovery, explicit outlet-to-location mapping, and outlet/month review evidence. Customer Feedback remains a distinct first-party domain and never supplies Performance Customer points. Customer stays pending until verified Google evidence exists, which blocks Performance finalization.

The outlet/month Admin context is permission- and outlet-scoped. While GBP API access is pending, new/positive/negative reviews, average rating, negative rate, trend, breakdown, feed, and Customer points are unavailable rather than zero. No Google review text, reviewer identity, rating, or derived scoring evidence is stored. Connection and location mapping controls remain unavailable until a server-side provider adapter can obtain verified accounts and locations. Credentials must remain server-side; browser code must never receive OAuth tokens. The configuration tables hold only connection status, verified location resource names, outlet mapping, and targets, with no review payloads.

An authorized Performance reviewer may set a positive monthly target greater than zero for an accessible outlet and whole performance month. Each change records the previous/new value, actor, and server time. Once any Performance result for that outlet/month is finalized, the target is locked. Provider data must eventually use each review's creation time to assign its month, classify 4–5 stars as positive, 3 as neutral, and 1–2 as negative. The future Customer contract has Positive Target `min(positive reviews / monthly target, 1) × 15` and Quality up to 5 from the current-month negative rate (negative reviews / eligible reviews): at most 2% → 5, >2–5% → 4, >5–10% → 3, >10–15% → 2, >15–20% → 1, >20% → 0. Neither calculation is enabled before the live Google authority is approved. Future integration must resolve Google retention/policy requirements and snapshot finalized evidence.

## Pre-API Google Boundary

The server-only `googleReviewsContract.ts` adapter is dormant: it has no OAuth handler, network implementation, persistence, scheduled job, or Performance/Reward caller. Account and location discovery are paged contracts; mappings must use verified provider resource identities. Review reconciliation walks every page, rejects partial/repeated pagination and foreign-location identities, deduplicates external review identity by update time, and preserves immutable creation time. Malaysia-local creation month determines eligibility; update dates and cumulative Google totals never define the performance month. Each complete reconciliation starts fresh rather than carrying forward removed reviews.

The unconnected scoring preview is tested against the approved 15-point target and 5-point quality thresholds, but is not an operational scoring authority. A complete reconciliation with zero eligible reviews keeps Customer Pending because there is no negative-rate denominator. Missing/partial evidence also remains Pending, never an employee penalty or finalized score. The V2 framework is active; Google-dependent finalization and Reward consumption remain blocked.

Google Reviews presentation distinguishes API pending, disconnected, unmapped, awaiting reconciliation, syncing, connection/sync failure, complete empty, available and finalized evidence. Metrics/feed require complete evidence; fixtures exist only in tests. Target history is a separate authenticated, permission/outlet/month-scoped configuration read (`crew_google_target_history`); it exposes prior/new targets and server timestamps, not credentials or raw actor identifiers. The existing target-write/finalization lock is unchanged.

The live gate requires API approval, authorized OAuth/account/location discovery, confirmed mappings, real pagination and reconciliation, and validation against real evidence. Separately, Google policy approval must establish whether aggregation and durable finalized Google-derived snapshots are permitted: current GBP policies restrict stored API content to 30 days and prohibit aggregation/manipulation of stored content. Do not activate scoring or add durable Google evidence retention merely because API access is granted. Provider credentials stay server-side and all live capability gates remain disabled until these requirements are resolved.

See [Google Business Profile policies](https://developers.google.com/my-business/content/policies) and [review-list API](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list).

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

Current Performance is Service Crew only and has one scoring model, `performance-v2`: Attendance 30, Service 30, Customer 20, Knowledge 15, and Peer Review 5. `calculation_version` records that model but does not select a legacy runtime branch or require a start-month switch. Attendance, Service, and Knowledge reuse their canonical authorities. Customer is explicitly pending until a separate Google Review authority is approved and delivered; FeedX Customer Feedback is never its fallback. While Customer is pending, `total_score` stays null, finalization is rejected, and Reward cannot consume provisional earned points. Historical applied migrations remain in repository/database lineage even though obsolete V1 operational evidence was retired by a forward-only cutover.

Peer Review assignments are opened near the end of a worked month by an outlet-scoped Performance reviewer. Eligible Service Crew must have completed same-outlet attendance; reviewer/subject pairs require actual overlapping worked time. A team of at least four aims for three distinct peer assignments per subject; a three-person team aims for two; teams of two or fewer remain pending for insufficient peers. Assignment generation is deterministic and additive, preserving previously submitted reviews. Each assigned Crew reviewer privately rates Teamwork, Reliability, Communication, and Work Attitude from 1 to 5. Valid submitted reviews are aggregated on the server as `round(5 * (mean_rating - 1) / 4, 2)` only when the subject's required count is met. Missing or administratively excluded reviews leave the Peer component pending, never zero. Crew receives only aggregate results, dimension means, completion progress, and its own outbound assignment list; authorized Performance reviewers can inspect identified submissions and record an explicit audited exclusion. Extreme and reciprocal ratings are flagged for Admin inspection but never automatically removed. Peer Review does not create Daily Tasks.

Open monthly Performance now resolves Service Crew eligibility, Position, Employment Status, Employment Type and Workplace through the People Employment Assignment Timeline for the performance period. A verified assignment from another month, today's Employee projection, and current Crew Access are not historical substitutes. The single-outlet monthly scoring model cannot safely represent a material intra-month assignment change, so such periods require review rather than using month-end identity. Before the verified People cutover, missing assignment history also remains unresolved. Open result components pin the applicable People revision IDs and assignment; a later historical correction masks stale scores until an authorized reviewer explicitly recalculates with a reason and audit entry. Source Peer Review, Customer Feedback, Attendance, Knowledge and Service evidence is retained. Finalized results remain pinned and are never refreshed from later People changes. Crew receives the safe period-correct result without resolver internals or stale open-score trends.



Attendance contributes a server-derived 30-point component: 15 points for completed eligible published shifts and 15 points for punctuality. Clock-ins at most 600 seconds after shift start receive no punctuality deduction; more than 600 through 1200 seconds deduct 0.5 points, more than 1200 through 2700 deduct 1.5 points, and more than 2700 deduct 3 points per eligible completed shift, with punctuality never below zero. No completed eligible evidence leaves the affected half at its neutral 12/15 baseline. Approved leave, non-working roster entries, schedules published or updated after their shift start, and reasoned active Attendance Performance exceptions are excluded. Finalized Performance snapshots remain immutable; only mutable current-period results refresh when attendance evidence changes.
The server derives protected scoring, eligibility, and reward values from canonical evidence and configured rules.
Reviewers may add permitted assessment evidence or decisions but cannot rewrite source-domain history.
Current mutable Service Standards reviews contain Welcome / Greeting, Thank You / Goodbye, Grooming, Work Area Cleanliness, and Guest Interaction. The server requires that exact current set and derives the observed-criterion denominator. Conduct is not a current Performance component. A finalized Performance period rejects new review evidence and remains immutable.
Mutable Performance labels the provisional sum as assessed points, names pending components, and reserves `/100` and the performance band for finalized results. Neither display changes review readiness or finalization eligibility. The complete Performance total and finalized snapshot remain the authority for downstream Reward; Reward does not consume mutable assessed points.

Crew trend presentation is a read-only comparison only when the current month has a finalized score. Partial assessed points carry scored/pending component context without a `/100` label, performance band, or comparison to a finalized prior month. A shared presentation formatter rounds a valid comparison magnitude to at most one decimal, normalizes floating-point no-change residue to zero, and never changes the server score, period selection, or Reward authority.

Reward consumes only finalized Performance. A mutable Current Score, regardless of its value, remains `awaiting_performance` for Reward and cannot create a Reward entry, projection, payout snapshot, or campaign-state change. Finalized and paid Reward entries remain the sole authority for final or paid amounts and historical payout records.

A Reward Campaign is finalizable only after its frozen participant set has a current complete calculation and every participant has a legitimate final Reward outcome: `qualified` or a documented non-payout `not_eligible` result. Missing, uncomputed, malformed, or `awaiting_performance` entries are payout-critical blockers. The trusted finalization authority locks and evaluates this readiness atomically before any entry/cycle mutation; the scoped Admin read model exposes only a human-readable readiness projection for review. Existing finalized and paid Campaigns are immutable historical evidence.

Customer Feedback preserves each guest submission as independent evidence. It owns `crew`, `food`, and `outlet` scope: only Crew feedback is attributed to an employee and may be included or excluded through an audited server authority. Its existing `scoring_status` is retained for feedback moderation/reporting compatibility, but Customer Feedback no longer contributes to Performance Customer points or Reward. Food and outlet feedback remains unassigned. Crew attribution remains one-to-one in the current phase; corrections use canonical Crew identifiers and retain prior/new attribution and reason in append-only audit history. Finalized Performance and Reward outputs remain immutable.

Customer Feedback also owns trust protection and complaint context. Public feedback supplies a first-party opaque anonymous device identifier; the server stores only its hash and uses deterministic, privacy-bounded signals to flag suspicious Crew evidence as `review_required`. Trust state is independent of inclusion state; neither state changes V2 Performance. Trust decisions, exclusions, and follow-up status transitions are append-only audit events. Improvement feedback records an outlet-local approximate visit time and business date separately from submission time. Optional guest contact information is stored in a separate follow-up record, returned only to authorized Customer Feedback follow-up roles, and is never available to Crew Mobile, Performance, or Reward.

Public guest feedback uses an outlet-scoped opaque `public_feedback_token`, not an outlet UUID, at `/feedback/<token>`. Guests choose Crew Member, Food & Drinks, or Overall Visit before submitting experience, scope-specific canonical tags, and an optional comment. The public resolver returns only the outlet display name, an optional public outlet-logo reference, and eligible recent/on-shift Crew; token submission resolves the outlet server-side and applies scope validation, dedupe, request-hash, and evidence insert. A retained compatibility refresh function is a no-op for Performance. Outlet logos are outlet-owned media managed through the canonical Outlet editor with scoped Admin upload/replace/remove authority; public feedback may read only the active public asset reference. Legacy `#feedback?outlet=<uuid>` links remain supported and normalize to the token URL after resolution. Admin Customer Feedback provides the selected outlet's QR, stable public link, copy action, local QR download, and a scope-aware evidence table without creating a separate Admin page.

Draft or open periods may evolve through controlled workflows.
Finalized scores, approved reward outcomes, and payout evidence are immutable or superseded through explicit correction authority.
Rule or weight changes must not retroactively alter finalized periods unless a deliberate recalculation contract exists.

Learning completion may qualify a Crew member for a skill or certification.
Learning owns the source completion; this domain owns the resulting operational qualification state and its performance/reward consequences.

## Permissions, Snapshots, And Audit

Admin access requires the relevant growth, performance, review, reward, or payout permission plus required scope.
Crew reads are token-bound and limited to the employee's own safe results and actions.
Evidence snapshots, finalized scoring, review decisions, reward calculations, approvals, corrections, and payout state retain audit history.

Customer Feedback Detail is the canonical Admin evidence view for submission content, visit context, current trust and scoring state, optional authorized follow-up contact/status, moderation history, and attribution correction history. The operational table keeps excluded and review-required evidence visible; period KPIs are scoped to the selected outlet and period rather than table search filters.

Customer Feedback table queries are server-paged (20/50/100 rows) after its selected period, scope, experience, inclusion, trust, and search predicates. Paging does not change evidence inclusion, moderation, or attribution authority.

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
