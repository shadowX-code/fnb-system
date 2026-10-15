# Google Reviews operational Production release

Production baseline: `8b4c40002aa4654d2ad88564b5c0f14577b639d6`. Verified Staging source: `0104cc3ef0c32128367708dd7422738d28d753c2`.

Included commits: `483a67eb7`, `ff19f6eb4`, `cb1b2b77a`, `cecf55429`, `0104cc3ef`. Phase 1/2, reply reconciliation and OAuth isolation are already deployed; do not replay their migrations. Mixed registry/routes/Role files retain current Production behavior outside Google Reviews. No unrelated dev merge.

## Ordered database delivery

Apply in **one transaction**:
1. `20261015163207_google_reviews_operational_permissions_sync.sql` (unchanged shared migration).
2. `supabase/production-migrations/20261015170923_google_reviews_production_sync_dispatch.sql` (Production-only overlay; never apply to Staging).

The overlay binds the existing scheduler to Production's Google gateway, with no new secret or second schedule. Record both versions atomically. Do not replay either applied version. Existing hourly content-purge jobs remain unchanged. Equivalent legacy Google access is migrated with audit; outlet scope and unrelated role assignments/grants remain unchanged.

## Recovery and verification

Private scoped pre-cutover catalog/state and prior Edge source captured in `/private/tmp/feedx-google-operational-release/`; completed physical backup `1973705526`, 16 October 2026 00:54 MYT. Code baseline and prior READY deployment retained. Rollback-only rehearsal against actual Production passed all create/replace guards, unique Cron and worker grants. Recovery requires a governed forward repair; do not reset credentials or mappings or replay shared migrations.

Production Release QA: focused candidate composition tests and build; proportional authenticated read-only Inbox/Settings/Detail/pagination smoke, service-only scheduler grants and one-use worker rejection. Existing Staging L3 covers permission/failure/concurrency scenarios. No role saves or real Google reply writes for release QA. Google scoring remains disabled.
