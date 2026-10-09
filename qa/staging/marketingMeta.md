# Marketing Meta Phase 1

L3 implementation and verification for the native Marketing workspace. Production remains untouched. The external app configuration is the remaining dependency for actual Meta OAuth and network publishing; a configured interface is not evidence of a connected account or successful delivery.

## Staging Meta configuration

| Setting | Exact value |
| --- | --- |
| Website | `https://fnb-system-staging.vercel.app` |
| Valid OAuth Redirect URI | `https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/callback` |
| Meta App Domains | `fnb-system-staging.vercel.app`, `ujkzdaaadnvcfayuldmh.supabase.co` |
| Deauthorization callback | `https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/deauthorize` |
| Data deletion callback | `https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-meta/data-deletion` |

Configure Facebook Login for Business using the User Access Token authorization-code flow. The selected configuration must request `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `read_insights`, `instagram_manage_insights` and `pages_manage_metadata` (read-only business-assignment verification). Discovery validates actual grants, granular account targets, Page tasks, app ID, subject and expiry. A Page-linked professional Instagram account is required; consumer accounts are unavailable.

Set these in **Staging Supabase Edge Function secrets**, never `VITE_*`, browser storage or chat:

- `MARKETING_META_APP_ID`
- `MARKETING_META_APP_SECRET`
- `MARKETING_META_LOGIN_CONFIG_ID`
- `MARKETING_META_GRAPH_VERSION` — a supported version for this app, e.g. the exact `vNN.0` selected in Meta Developers, not an assumed latest version.
- `MARKETING_META_TEST_ACCOUNT_IDS` — comma-separated numeric Page/Instagram IDs approved for test publishing. Empty means no publishing. Configure before connecting, or reconnect after changing the allowlist.

Internal `MARKETING_META_TOKEN_ENCRYPTION_KEY` and `MARKETING_WORKER_SECRET` were generated on Staging. The scheduler key is also stored as `feedx_marketing_worker` in Staging Vault. No existing credentials were overwritten; temporary copies were removed after worker verification. The optional `MARKETING_META_PREVIOUS_TOKEN_ENCRYPTION_KEY` supports controlled key rotation: retain the previous key during reconnect/re-encryption, then remove it once all current grants are refreshed. Do not discard a required decryption key before reconnecting accounts.

Meta also requires applicable public privacy policy and data deletion information in its app settings. Use the organization’s approved policy; this implementation does not invent a legal policy or publish one. App Review/advanced access is a production authorization dependency, not a blocker for configured app-role/test-account verification.

## Implemented contracts

Single-use, ten-minute OAuth state is bound to canonical employee, organization, brand and the fixed redirect. Scope is revalidated at callback and selection. Discovered accounts remain private to the authorizing actor for fifteen minutes. Selection retries retain the same connection generation; a changed selection requires a new OAuth session. Tokens use AES-GCM with brand/channel/account binding and server-only current/previous keys. Public metadata never includes token ciphertext, token references or Auth credentials. Expiry housekeeping, reconnect, local disconnect, HMAC-authenticated Meta deauthorization and deletion are implemented. Removal replay is idempotent and cannot erase a later consent grant. Deletion status exposes only an opaque confirmation and completion time.

Connecting does not release a backlog. `marketing_content.publish` schedules; `marketing_content.execute` separately approves the exact saved revision and account generations. Only allowlisted test accounts are enabled; the worker independently checks that allowlist before every provider operation. Production account execution is disabled. Job checkpoints save intent before each write and response IDs afterward. Each tick advances one durable step, with leases, bounded error retries, processing deferral, real receipt requirements and reconciliation. Expired leases resume completed checkpoints only when no write intent is pending. Uncertain writes freeze content and are never automatically repeated. A missing receipt after a timed-out request remains Reconciling for investigation; no caption/time heuristic invents a matching post ID.

Supported adapters: Facebook text/images/carousels; Instagram JPEG images/carousels and MP4 Reels. Facebook Reels, Stories and messages are unavailable. Images are conservatively limited to 8 MB for publishing; Instagram JPEG width 320–1440 px and aspect ratio 0.8–1.91. Videos are limited to 50 MB for this worker, with actual platform processing checked before Instagram publication. The library still stores/privately previews JPG, PNG, WebP and MP4 up to 100 MB. One immutable source asset is verified per tick before any write; provider URLs are short-lived server-generated links, never arbitrary client URLs.

Post sync uses fixed official Graph endpoints and opaque cursors, two posts per tick, up to eighty recent posts per traversal. The UI indicates truncation and collection time. Facebook public engagement counts and available Instagram `reach`/`views` insights are retained only from actual API responses; missing/unsupported metrics remain unavailable. Facebook reach/views are explicitly unavailable in this adapter. Metrics do not establish conversions, deduplicated group reach or incremental revenue.

## Read-only connection diagnostics

Settings → Check connection invokes authenticated `/diagnose` without reconnecting or enabling execution. Verify a valid scoped manager can inspect an existing errored connection, unknown/wrong actor is denied, and anon/authenticated cannot execute the service-only material RPC. Confirm only fixed Graph GETs, generation/scope checks before each request, safe code/subcode and permission-name output, and no token, raw provider message, profile subject or content leakage. Compare full Facebook sync fields with minimal IDs, then isolate optional fields only if minimal reads succeed.

Failed Facebook read recovery is a separate Retry Sync command: validate retained PAGE token/app/identity/expiry and corrected core read before clearing only the read failure. Confirm stale/null generations, unknown actors and client-role RPC execution are denied, and credentials/execution flags remain unchanged. Optional engagement denials must preserve posts with unavailable metrics; token code 190 and authority failures still abort.

## Verification

Discovery diagnostics: filter Staging `marketing-meta` function logs for `marketing_meta_discovery_v1` over the single fresh OAuth attempt's time window. `graph_response` for `me/accounts` distinguishes an empty successful response, a Graph denial, unreadable data and absent transport response. `page_candidate` records recognized tasks, numeric linked Instagram identity and `accepted`, `rejected_invalid_page_id` or `rejected_missing_page_token`. Compare all returned Page IDs with the intended test Page before accepting any identity or registering an allowlist. These logs contain no credential/profile fields. Empty enumeration can fall back only to verified `pages_show_list` granular Page targets; exact identity and a nonempty Page token are required. `page_candidate.source` distinguishes enumeration from `granted_page_node`; direct Page-node data never establishes tasks; the separate exact-authorizer Page roles resolver may supply verified tasks, otherwise publishing remains disabled. Test wrong returned IDs, absent/empty tokens, absent/invalid grant targets, granular read restrictions and diagnostic redaction. Alternative account-list probes remain diagnostic-only.

- Focused adapter/UI/security tests: OAuth app/grant/expiry verification, AES-GCM binding and rotation, signature forgery, safe endpoint construction, durable upload/publishing steps, lost-response retries, persistence failures after acceptance, processing polls, media byte checks, missing metrics, expired UI and explicit reviewed-revision approval.
- Deno checks pass for both Edge Functions; Vite build passes.
- `marketingMeta.rollback.sql` passes on linked Staging: single-use state, hidden brand and redirect denial, service-only credentials/bind/checkpoints, actor-bound discovery, idempotent selection, no backlog release, server execution gate, exact retry approval, durable receipt requirement, uncertainty freeze, disconnect/erasure and privilege boundaries. All fixtures roll back and call no provider.
- Updated `marketingFoundation.rollback.sql` passes with the separate execution gate.
- Live endpoints: configuration 200 with missing Meta names and no secret values; unauthenticated authorize 401; unknown deletion code 404; unauthenticated scheduler 401; authorized scheduler 200 with blocked `meta_not_configured`. Vault/cron authentication is enabled; no successful publishing is simulated.

Canonical Staging UI/storage verification and deployment SHA are recorded after delivery below. Actual Meta grant exchange, platform media fetch, live receipts and account metrics require external Meta configuration and explicit test-publishing approval. Do not publish to real brand accounts without explicit approval. No Phase 2–5 provider is configured by this work.

## Canonical Staging runtime evidence

Implementation SHA `f84168a3bcd14dc277f69a82f94061bf7f3cb073`, Git Integration deployment `dpl_FBEuMrbQXTHxA241X4D29oTmnYsV`: READY on project `prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi`, with canonical `fnb-system-staging.vercel.app` alias and matching clean dev/origin SHA. Target verification passed. Broader route/shell/pagination/permission/Marketing/date regression: 34 files, 127 tests passed; build passed with existing bundle-size advisories.

Authenticated UI verified configuration status, disabled Connect action, real private upload/finalization, immutable asset selection, saved revision previews, Review → Approved → Scheduled, native datetime entry, timezone conversion, disabled external approval, both channel states in Calendar and source-aware Analytics. The generated PNG decoded at 1024×1024; generated MP4 (H.264/AAC) decoded at 360×640, four seconds, no media error. Schedule `2026-10-11 09:00 Asia/Kuala_Lumpur` stored as `2026-10-11T01:00:00Z`, approved revision 2. Both jobs remained Blocked, zero attempts, null provider receipts and null execution approvals. No captured console errors.

One new empty QA organization/brand and two generated assets were used; no real outlets, employee permissions or Meta accounts were changed. Both blobs were deleted via the Staging Storage API; exact guarded fixture cleanup removed the QA hierarchy, creative revisions, audit/request rows and jobs. No persistent QA data remains. Native image/video previews are verified; external Meta fetching and publishing are explicitly unverified until app configuration and approved test accounts are supplied.

Primary API references: [Meta Instagram collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [Meta server app-secret proof](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/session.py), [Meta current insight metric definitions](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/instagram-insights-result.js). Runtime capabilities and actual returned metrics still determine availability for the configured app version/account.

Final checks also verified same-second signed-removal replay, old-event consent preservation, projection erasure, safe completed-checkpoint lease recovery and uncertainty retention after a failure. App-secret proof follows Meta’s server SDK; final adapter tests and Deno checks pass. Default narrow and desktop viewport checks showed no horizontal overflow; the user viewport was restored.

Publishing acceptance check: invoke Check connection for Facebook and Instagram independently. Compare debug token validity/app/type/expiry with Page identity; inspect `can_post`, the authorizer-filtered Page roles response and required grants. For Instagram, require exact linked numeric identity before professional identity and quota reads. Successful reads or `can_post=true` must not replace MANAGE/CREATE_CONTENT task evidence. Confirm no provider POSTs, no capability/binding/credential changes, no external-approved jobs, and no test drafts while task eligibility remains unverified.

Task resolver verification: User accounts returns task-bearing Page relationships; Page roles is the supported narrow fallback filtered by the verified token’s user ID, with exact active-subject matching. Verify empty, wrong/duplicate subjects, unknown task vocabulary, absent active state and provider denials remain unverified; explicit non-content tasks remain not granted. Require MANAGE/CREATE_CONTENT for both channels, exact Instagram linkage and unchanged granular scope restrictions. Never accept permitted_tasks as granted tasks. Page assigned_users is unavailable without pages_manage_metadata and verified business context; assigned_pages requires a verified business-scoped subject. No repeated OAuth attempt is needed to inspect the retained Page credential through roles. Do not persist capabilities from diagnostics or enable execution.


Business task authorization correction (focused L3): keep the same Meta app, Login Configuration and seven existing scopes; add only metadata permission. Perform one fresh OAuth only after configuration readiness and explicit consent to the expanded grant. Inspect sanitized mapping HTTP/code/subcode and mapped business count; mapping must use the verified fresh USER relationship, never name matching. Verify exact Page assigned-user tasks using the mapped business ID and Page credential, complete pagination, actual tasks and exact business-scoped subject. Reject absent/ambiguous mapping, a different current token subject, absent metadata grant or wrong granular Page target, permitted_tasks-only grants, other assigned users and unresolved Graph errors. Do not request business_management automatically. Verify FB/IG eligibility independently under unchanged per-channel grants/link checks; rebind only existing verified Idamans IDs. Fresh binding resets execution disabled regardless of eligibility/allowlist. Retain User-token ephemerality and encrypted identity mapping; no personal IDs or credentials in diagnostics. No publishing, OAuth loops or unrelated QA.
