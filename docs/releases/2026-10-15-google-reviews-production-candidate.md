# Google Reviews Phase 1 + Phase 2 Production candidate

## Scope and provenance

Production base: `5224eeade2e7438c7810c2aa8524422443e9e1ab`. Canonical Staging source: `ac44ecd9a40456130b7e15b8c5c6b3d7059b4f51`.

Google-owned frontend/service/adapter/QA files are selected from that source. Existing Production navigation/route/module/Performance logic is preserved; route ownership gains only safe `google_result` query support. Shared AES-GCM and Google transport libraries are required imports, not new Marketing integrations. No Marketing, Recruitment, Reader, Guest AI, Payroll, Factory or Reporting delivery is included. Customer Feedback/employee scoring/target authority stay unchanged; Google scoring is false.

The candidate additionally replaces the Google gateway's Staging-only guard with a fixed two-project environment allowlist. Staging callback/origin/bindings remain unchanged; Production origin is `https://os.feedx.my`, callback is `https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/google-business/callback`. Nothing is deployed by candidate preparation.

## Ordered migration manifest

| Migration | Purpose | Prerequisite | Production action | Recovery |
|---|---|---|---|---|
| 20261014094703_crew_google_business_phase_one | Private encrypted OAuth/cache/audit authority; mapping revision; independent purge | Existing Google foundation, Auth/employee/outlet permission helpers, pg_cron | Apply first | Restore pre-cutover schema/UI recovery point; keep encrypted evidence, do not casually drop/replay |
| 20261014103818_crew_google_business_rest_guard | Qualified trusted UPDATE/DELETE under REST guard | Phase 1 exact function body | Apply second | Definition guard stops drift; recover reviewed authority snapshot |
| 20261014130653_google_business_owner_replies | Audited encrypted reply intents, leases, idempotency, scoped authority and content purge | Reviewed Phase 1/follow-up definitions | Apply third | Preserve audit/intents; frontend rollback never undoes a Google reply |
| 20261014132350_google_business_reply_write_guard | Revalidate permission/mapping/grant/lease before external write | Owner reply authority | Apply fourth | No drops; preserve write guard and evidence |
| 20261014135852_google_business_reply_readback | Scoped unexpired accepted reply projection for safe read reconciliation | Confirmed reply evidence | Apply fifth | Preserve history; recover read authority without erasing accepted evidence |

Skip `20260925065635`, `20260925070543` and `20260927131723`: Production already has their equivalent foundation. Do not replay for ledger alignment. Production latest ledger at inspection is `20261013091929`; these five new versions follow it. Use an isolated five-migration deployment manifest, not an unrestricted push of unrelated dev migrations. Perform final drift/dry-run checks immediately before any separately approved cutover.

## Catalog compatibility evidence

Read-only Production catalog: no `google_business_private` schema, no new public gateway/reply function signatures, no mapping `revision` column, and no conflicting purge cron names. Thus new tables/constraints/indexes/private functions/policies cannot collide in the absent private namespace. The only existing-table alteration is its missing mapping revision column. All required existing permission/outlet helper signatures and pg_cron are present. Existing location/mapping column types/nullability match Staging; baseline context/history function definitions have identical MD5 values in both environments (`168d24bc4264434c893d6086e2805ae7`, `75d11d3f6d41db4faaf3a1c22ba423fd`).

The five unchanged migrations already ran on canonical Staging, including guarded definition checks. New environment/route composition tests and Production-based build pass; completed L3 mutation tests are reused. All five migrations also passed a disposable PGlite PostgreSQL DDL rehearsal seeded with the inspected Production configuration columns/constraints and empty core identity/outlet tables. Both guarded function transitions passed, all four public signatures were created, and both purge jobs were registered through a local cron.schedule shim. This checks ordering, SQL creation and definition guards; it is not a full Production clone or repeated Auth/lifecycle QA. Production was queried read-only; no Production DDL was executed. Keep the final fresh catalog/dry-run/recovery gate for cutover.

Only `google-business` needs Edge deployment, including its shared crypto/transport/read/reply/environment modules. It is absent in Production. Its body verifies Admin Auth and canonical permission/outlet scope; callback validates expiring one-time state/PKCE. `verify_jwt=false` is limited to this function's public callback, not a business authorization bypass. No shared secret, token, mapping, cache, review or QA record is copied from Staging.

## OAuth readiness and blockers (read-only inspection)

Google Cloud project `FeedX Production` / `feedx-production` / 523893489763 has one existing `FeedX Business Profile` Web client. Audience is External/Testing with one allowed test user. Publish app is disabled for incomplete Branding: home, privacy and terms URLs are blank. Only the Staging Supabase callback and temporary localhost callback are registered; Production callback above is absent. Only Staging Supabase domain is registered in Branding. `business.manage` appears under non-sensitive scopes; no sensitive/restricted scopes are configured. Verification Center reports no verification required *because Testing*, not a Production clearance. Complete truthful branding/authorized-domain/ownership requirements and check publishing/verification eligibility; do not infer it from API allowlist approval. Testing-mode non-basic offline grants expire after seven days.

Production Supabase has no GOOGLE_BUSINESS_CLIENT_ID, GOOGLE_BUSINESS_CLIENT_SECRET or GOOGLE_BUSINESS_TOKEN_ENCRYPTION_KEY. Provision server-only credentials and a distinct encryption key after approval; do not copy Staging grants. Explicit owner OAuth consent, discovery and outlet mapping are required after deployment; locations may remain unmapped. No names are inferred.

Google revocation invalidates a user's issued tokens for all OAuth clients registered in the same project. A second client within the same project does not provide independent Disconnect semantics. Resolve environment project/grant isolation before activation (e.g. keep approved project for Production and separately approve/move Staging to an isolated project). No new client/project is created here. If a shared project is retained, its coupled revocation requires an explicit changed isolation decision.

## Actions still requiring approval

OAuth publishing/branding/authorized domain or redirect changes; environment project/client isolation changes and any new credentials; Production server secrets; recovery point/final migration dry run and application of only the five ordered migrations; Google Edge deployment; scoped candidate main merge and exact FeedX Production deployment; owner consent, read-only discovery/mapping/sync. Real Google reply publication/edit/delete requires a separate exact review/text approval and is not release QA.

## Sources

- https://developers.google.com/identity/protocols/oauth2/production-readiness/overview
- https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance
- https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
