# Google Reviews operational verification

QA level: L3 canonical. Staging project only: `ujkzdaaadnvcfayuldmh`.

- Run focused matrix/role scope, navigation, Inbox/Settings/Detail and shared Google sync/reply tests.
- Run `qa/staging/googleReviewsOperational.rollback.sql` inside BEGIN/ROLLBACK after the migration. Fixtures modify existing identity/configuration only transactionally. pg_net starts only after commit, so the rollback dispatch never calls Google. Checks cover View-only vs Sync/Publish/Edit, scoped vs global administration, foreign outlets, duplicate claims/dispatch, worker-only command whitelist, manual/automatic overlap, rate cooldown, independent locations, mapping revision changes and expired cache rejection.
- Deploy the Google gateway with `verify_jwt=false` for callback/scheduler; browser commands still validate Admin Auth, and scheduler commands require the database-issued one-use capability. Verify missing/invalid worker headers are rejected before token access.
- Invoke canonical `google_business_private.sync_tick()` once and inspect only run summary, HTTP status and sync metadata (never request headers/tokens). Confirm all explicitly mapped active outlets complete, and inspect actual scheduled execution via cron job run details.
- Read authenticated Staging Inbox/Settings and Permission Matrix; verify cadence/last success, 4 explicit mappings/8 discovered locations, action labels and responsive layout. Do not save role changes or publish real replies.
- Mock Google updates/deletions, pagination duplicates, 5xx/network failures, 429 and permission failures. Real provider calls during this verification are reads/token refresh only.
- After verification, preserve the existing connection generation and mappings, ensure no new reply requests, and do not deploy Production.
