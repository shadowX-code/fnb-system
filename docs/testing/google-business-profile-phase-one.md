# Google Business Profile Phase 1

## Environment and custody

Google project: `feedx-production`, number `523893489763`. Reuse the single **FeedX Business Profile** Web client. The client is External/Testing with the approved owner test user. Its old loopback callback is a temporary readiness-test URI; the deployed Staging callback is:

`https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/google-business/callback`

The permanent callback handles state/PKCE server-side and redirects to the canonical Admin Google Reviews route with a non-sensitive outcome only. All commands verify Admin Auth and canonical permission/outlet scope. The function rejects execution against a Production Supabase URL. Deploying this Staging implementation does not authorize Production credentials, callback, migration or application deployment.

Set the existing client credentials and a random 32-byte encryption key in Staging Edge secrets only. Never put them in frontend variables, source, screenshots, command-line arguments or logs. Use an owner-only temporary env file with `supabase secrets set --env-file`, then remove the temporary file after verified upload. Key rotation uses `GOOGLE_BUSINESS_PREVIOUS_TOKEN_ENCRYPTION_KEY`; do not rotate blindly because existing token and cache ciphertext must remain decryptable.

Connect/Reconnect requires the authorized Google account owner to consent to `business.manage` and offline access. This Google scope can authorize profile changes, while this FeedX Phase 1 implementation exposes only GET business operations plus OAuth token exchange/refresh/revocation. Google Testing-mode grants may expire and need reconnection; they are not a Production publishing/readiness decision.

## Verification

- Focused provider tests: `googleBusinessProfile.test.ts` covers fixed GET transport, full 50+16 pagination, identity/reply deduplication, partial/foreign/conflicting evidence rejection, encryption binding and official token refresh/revocation endpoints.
- `googleBusinessPhaseOne.rollback.sql` checks service-only grants, one-time OAuth, generation transitions, mapping uniqueness, sync leases, token compare-and-swap, canonical scoped reader/outlet isolation, revocation-pending access denial and content purge. Every fixture rolls back.
- Workspace tests cover disconnected/read-only access, authentic reply/source rendering, filtering, actionable failures and unchanged audited monthly target configuration.
- Canonical authenticated Staging: connect the authorized owner; verify all eight known locations are returned; explicitly map JYMT to its verified resource; sync both pages; confirm deduplication/readback and existing reply absence/presence without changing Google data. Use Refresh locations to verify a real refresh-token exchange. Reconnect must preserve only still-authorized mappings and invalidate the old inbox cache.
- Check anonymous commands and direct authenticated RPC/table access are denied. Verify another outlet cannot read JYMT's cache. No real employee Performance, Customer Feedback or Google review/reply mutation is part of this test.

If a 429 occurs, record the safe API service/request from the surfaced error or structured server event first. Do not expose token bodies, OAuth codes, state or credentials. Do not repeatedly retry or raise project quotas blindly.

## Limits

An on-demand sync supports at most 100 provider pages / 5,000 rows per walk and fails clearly above the limit. Read content expires after 24 hours and is purged hourly; expired content is also hidden by the server/browser read projections. This phase has no automated reply publication, AI responses, Performance scoring or durable Google-content evidence archive. See the [Google Business Profile policies](https://developers.google.com/my-business/content/policies) before extending retention or scoring.

## Verified Staging acceptance — 14 October 2026

- Applied `20261014094703_crew_google_business_phase_one` and guarded forward `20261014103818_crew_google_business_rest_guard`. The latter preserves the reviewed authority while qualifying cleanup by connection generation and mapping updates by the verified inventory; the platform's REST safety guard remains enabled. The initial failed OAuth save rolled back rather than partially connecting.
- Real owner-authorized HTTPS OAuth persisted encrypted credentials and discovered one account/all eight known locations. JYMT was explicitly mapped to `accounts/115091780286792749811/locations/2459231181501016473` on Staging only.
- Live synchronization retrieved/rendered 66 unique reviews through the page-size-50 endpoint. Repeat sync and post-reconnect sync each retained 66 records. JYMT has no owner replies; populated reply rendering/retention is covered by fixtures, not invented Google content.
- Live rating, owner-reply, unmatched search and Malaysia creation-month filters passed. October 2026 contained four reviews; Friends Corner displayed no JYMT content. The shared month picker now labels its optional empty selection as All months without changing existing consumers' defaults.
- Refresh locations exercised a real refresh-token exchange, renewed the server expiry and retained the mapping. Reconnect advanced generation 1 → 2, retained the authorized mapping, cleared old cached content and required fresh synchronization. An expired OAuth attempt preserved the prior working connection/cache.
- Service-only RPC/schema grants, OAuth replay rejection, limited-role outlet isolation, mapping uniqueness, sync leases, token compare-and-swap, revocation-pending denial and content purge passed transaction-rolled-back SQL verification. Revocation's official HTTP endpoint/error behavior is mock-tested; a live disconnect/revoke was not performed against the retained working Staging connection.
- No Google 429 was observed during successful verification. Diagnostic regression proves exact service/request reporting and zero automatic Google retries; refreshing FeedX's own stored context after a failure does not retry the provider operation. Secrets upload files were removed and no credentials/token bodies entered source or reports.

The client remains External/Testing. Public branding/publishing and Production configuration/release require separate work and authorization.
