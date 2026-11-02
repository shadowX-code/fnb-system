# New Crew Onboarding scoped Production release

Approved source: canonical Staging `1ff89608d93dd98efe61252eb35fd4a2950632a0`.
Production baseline: `08d288ade6a2b28aec0639c81d63e6fd0ea645e7`, READY deployment `dpl_BppABYSaMAqzE9o16j1RtwWF4Qfk`.

## Scope and isolation

Includes full-page Builder, atomic Draft persistence/reorder/removal, Knowledge Check editing/deletion, lesson preview, Published Preview, unified Course Overview/Crew Progress, published-only summaries and shared initial/avatar/progress presentation. Includes only the required localization active-unit filter, shared lesson-renderer extraction and shared Admin progress color option. Crew defaults remain unchanged.

Excludes unrelated Guest AI, Factory, Restaurant/agent, Payroll, Marketing, reporting, Home CSS and global font-selector changes. Production baseline changes remain intact. No wholesale dev merge.

## Ordered database manifest

1. `20261102073413_crew_onboarding_atomic_builder`: revision/idempotency metadata; deferred sibling order constraints; scoped atomic Draft save; matching-revision publication wrapper; publisher row lock; snapshot-derived Admin progress metadata; removal of browser child-table DML. Requires the reviewed existing publisher/progress hashes and existing localization/read/media authorities.
2. `20261102080643_crew_onboarding_conflict_feedback`: forward replacement returning PT409 for business revision conflicts, preserving the atomic save/publication contract and avoiding PostgREST engine retry behavior. Requires step 1.

Production ledger and catalog initially contain neither migration nor equivalent new columns/functions. Existing publisher hash `708b76beda7888b4fc022b795125e5f2` and progress hash `6a6f4b743bb375ba555a06c2675f7348` match both migration guards. The full chain executed successfully on the actual Production catalog inside BEGIN/ROLLBACK. A curated ledger-aware CLI dry-run selects exactly these two versions, without seeds, roles or vault changes. No identity-equivalent migration is replayed.

## Verification and preservation

Isolated Production-based candidate: 51 focused UI/service/localization tests pass; production build and diff check pass. Completed canonical Staging authority tests are not repeated.

Before cutover: aggregate counts/fingerprints captured for learning structure, assignments, lesson progress and quiz evidence, excluding only the three new revision metadata columns from journey comparison. No raw employee/quiz evidence is exported. Initial Production has two Draft courses and no published course, assignments, progress or quiz attempts. No course will be published or enrollment/quiz/progress evidence manufactured for release QA.

Apply only the manifest before one main push. Recheck main/live SHA and catalog guards immediately before cutover. Verify the ledger, function signatures/permissions, deferred constraints, PT409 conflict authority and unchanged evidence fingerprints before frontend delivery. Then use authenticated read-only Production smoke against available Draft/empty states and existing Crew learning. Published-preview and populated-progress runtime coverage remains the completed Staging evidence where Production has no such records.

## Recovery

The retained baseline commit/deployment and catalog guard/permission metadata are the scoped recovery reference. The migrations do not publish, enroll or rewrite learning evidence. Prefer a reviewed forward recovery; do not blindly redeploy the old browser Draft writer after its direct DML grants are revoked. No automatic rollback, record deletion or historical snapshot repair is authorized by this release.
