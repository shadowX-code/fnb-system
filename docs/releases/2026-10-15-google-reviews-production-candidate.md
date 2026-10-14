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
| 20261014181028_google_business_disconnect_isolation | Environment-local Disconnect; separate confirmed project-wide Google revoke | Phase 1 connection transition authority | Apply sixth | Keep local clearing and explicit revoke separate; never restore old automatic revoke path |

Skip `20260925065635`, `20260925070543` and `20260927131723`: Production already has their equivalent foundation. Do not replay for ledger alignment. Production latest ledger at inspection is `20261013091929`; these six new versions follow it. Use an isolated six-migration deployment manifest, not an unrestricted push of unrelated dev migrations. Perform final drift/dry-run checks immediately before any separately approved cutover.

## Catalog compatibility evidence

Read-only Production catalog: no `google_business_private` schema, no new public gateway/reply function signatures, no mapping `revision` column, and no conflicting purge cron names. Thus new tables/constraints/indexes/private functions/policies cannot collide in the absent private namespace. The only existing-table alteration is its missing mapping revision column. All required existing permission/outlet helper signatures and pg_cron are present. Existing location/mapping column types/nullability match Staging; baseline context/history function definitions have identical MD5 values in both environments (`168d24bc4264434c893d6086e2805ae7`, `75d11d3f6d41db4faaf3a1c22ba423fd`).

The five unchanged migrations already ran on canonical Staging, including guarded definition checks. New environment/route composition tests and Production-based build pass; completed L3 mutation tests are reused. All five migrations also passed a disposable PGlite PostgreSQL DDL rehearsal seeded with the inspected Production configuration columns/constraints and empty core identity/outlet tables. Both guarded function transitions passed, all five public signatures were created, and both purge jobs were registered through a local cron.schedule shim. This checks ordering, SQL creation and definition guards; it is not a full Production clone or repeated Auth/lifecycle QA. Production was queried read-only; no Production DDL was executed. Keep the final fresh catalog/dry-run/recovery gate for cutover.

Only `google-business` needs Edge deployment, including its shared crypto/transport/read/reply/environment modules. It is absent in Production. Its body verifies Admin Auth and canonical permission/outlet scope; callback validates expiring one-time state/PKCE. `verify_jwt=false` is limited to this function's public callback, not a business authorization bypass. No shared secret, token, mapping, cache, review or QA record is copied from Staging.

## OAuth configuration readiness — 15 October 2026

Existing approved project remains `FeedX Production` / `feedx-production` / 523893489763. No extra Google project was created. Existing Staging client/grant are preserved. A dedicated `FeedX Business Profile Production` Web client is registered with only `https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/google-business/callback`, no JavaScript origins. Scope remains `business.manage`; Google currently classifies it non-sensitive.

User approved the new client and secure Production secrets. Three server-only GOOGLE_BUSINESS secrets were stored and verified by digest: CLIENT_ID, CLIENT_SECRET, TOKEN_ENCRYPTION_KEY. Each differs from Staging. The unused initial secret accidentally appeared in a browser tool response; it was disabled and deleted with user approval before any use/storage. Only its privately captured replacement was stored; ephemeral plaintext files were removed. No Production Google grant, mapping, cache or outlet connection exists or was copied.

Branding now saves approved home `https://feedx.my/`, Privacy Policy `https://feedx.my/privacy`, and authorized domains for feedx.my and both Supabase callbacks. Terms is deliberately blank: `/terms` currently serves the marketing homepage through fallback and no approved public Terms document was found. Existing employee Terms are not public SaaS Terms. Prepared routing instructions in `2026-10-15-google-reviews-terms-routing.patch` remain unapplied until approved public content is supplied. No legal text was invented or published. Legal owner must confirm any Google-specific disclosure changes before edits.

External/Testing is still active. Testing non-basic offline grants expire after seven days. API allowlisting does not itself establish OAuth publishing/brand verification readiness. Check Google publishing/verification and domain-ownership requirements before activation; no unsupported Terms URL is submitted.

Google revocation affects the user's grants across clients within the same Google project. Separate clients alone do not isolate it. Necessary candidate security correction makes ordinary Disconnect atomic/local only, and puts Google-wide revocation behind a separately confirmed action with an explicit cross-environment warning. This is the smallest same-project configuration; no project move or Staging reconsent is needed. Dedicated credentials/keys and separate Supabase databases isolate token/mapping/cache storage.

## Focused correction verification

22 focused UI/environment/disconnect tests passed; candidate build passed. Six migrations passed local PostgreSQL-compatible DDL/definition-guard rehearsal. Synthetic disconnect checks verify stale-generation rejection, explicit project-wide acknowledgement, atomic local clearing, repeat-safe disconnected calls, global begin/finalize and service-only execute grants. Permission helpers/cron are test shims; this does not claim a full Production clone or repeat completed L3. Real Google disconnect/revoke/write was not invoked.

Staging received only the sixth migration and Google gateway/UI safety correction. Before/after connection remains connected, generation 2, identical encrypted-token fingerprint. Production received approved server secrets only: no migrations, Edge/frontend deployment, main merge, outlet connection or Google writes.

## Actions still requiring approval / completion

- Supply/approve public Terms content before publishing `/terms` or adding it to Branding. Proposed routing is prepared only.
- Confirm Google OAuth audience publishing and complete any requested branding/domain verification; this is distinct from API allowlisting.
- Separately approve the six-migration Production release, recovery point/final drift/dry-run checks, Google Edge deployment, scoped main merge and exact FeedX Production deployment.
- After that deployment, Google account owner must complete Production consent. Discovery and explicit outlet mapping/sync follow; no Stage grants/mappings are promoted.
- Real Google reply publishing/edit/delete always needs separate exact review/text approval and is not release QA.

## Sources

- https://developers.google.com/identity/protocols/oauth2/production-readiness/overview
- https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance
- https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
