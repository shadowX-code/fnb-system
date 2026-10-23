# Inbox analytics channel contract and Production correction

## Confirmed diagnosis

Production frontend `ad20732e5dc5426a1139c28322589b45352ca137` passes `org`, optional Brand, selected channel and optional half-open created-at date bounds through the canonical `inboxService.analytics` adapter. All Channels is `social` (excludes internal cases); the lower-level empty channel includes internal cases. The deployed RPC accepted `'', social, internal, facebook, instagram` but omitted `whatsapp`. The same function definition was installed on Staging (MD5 `b1d806baff3b570470ede0a0d0bbefee`).

The three original Production POST requests to `/rest/v1/rpc/marketing_inbox_analytics` returned HTTP 400. Gateway start timestamps (UTC): `2026-10-23T06:13:22.515Z`, `06:13:36.310Z`, `06:13:50.018Z`. Corresponding PostgreSQL error timestamps: `06:13:26.077Z`, `06:13:36.708Z`, `06:13:50.066Z`. Every error was SQLSTATE `P0001`, message `Invalid analytics filters.`, at function line 4 (`RAISE`). The preceding All Channels request at `06:13:19.500Z` returned HTTP 200.

Gateway logs retain method/path/status/request ID; PostgreSQL logs retain the prepared statement with its `$1` JSON bind, not the original JSON body values. The local diagnosis receipt records request IDs, exact parameters used for the read-only authenticated SQL reproduction and this limitation. A fresh `whatsapp` invocation under the captured Production principal reproduced the same validation error in `BEGIN READ ONLY`; social/FB/IG returned valid metrics. No browser token, header, credential or raw session was exported. Native network capture was not used as evidence because browser control was interrupted; do not represent reconstructed parameters as captured historical request bodies.

The rejection occurs before any conversation aggregation, so zero connections cannot cause it. Each logged HTTP request has its own request ID and one PostgreSQL validation failure, not a database retry loop. The UI already had normal channel/Brand/refresh analytics reads before this frontend release; its analytics adapter/effect were unchanged. A 30-second visible-page refresh or a filter/scope change can repeat the invalid request, but duplication is not the defect. WhatsApp support was added to Inbox reads by Foundation without extending analytics validation; the dormant UI acceptance exposed that older contract gap.

## Owning-layer correction

`20261023063351_marketing_inbox_analytics_whatsapp_channel.sql` adds only `whatsapp` to the existing RPC validation allowlist. It pins the reviewed definition before replacing that clause. No query, cohort, median/acceptance formula, date boundary, actor/Brand check, grant, schema, connection, AI or send authority changes. Definition MD5 after correction: `2892b5623fd5651314fddeac24c2322b`.

The migration was applied on Staging (`ujkzdaaadnvcfayuldmh`) with ledger version `20261023063351`, name `marketing_inbox_analytics_whatsapp_channel`. Its generated local source filename was aligned to this application receipt before commit; no ledger repair or replay occurred. Production remains unchanged.

## Focused verification (L3)

- `qa/marketing/inboxAnalyticsContract.sql` runs only in a fresh local database named `inbox_analytics_contract_qa`, with local scope stubs and disposable records. Use `psql --dbname=inbox_analytics_contract_qa -f qa/marketing/inboxAnalyticsContract.sql`. It rolls back everything and must never run on a shared environment.
- It compares all old channel metrics before/after; tests zero and nonzero WhatsApp, social/internal inclusion, half-open dates, unavailable rates, unknown/null channel rejection, Brand/tenant rejection, identical ACL and byte-identical function body after reversing the one clause replacement. No shared QA users, permissions or conversations were created.
- Staging existing authenticated identity: all/empty, social, FB, IG and WhatsApp reads pass; Brand-scoped WhatsApp returns zero; a Brand outside the selected tenant is rejected with `42501`. The function retains STABLE, SECURITY DEFINER, controlled search_path and its original authenticated/service ACL, with no anonymous grant.
- Authenticated Staging browser: All Channels = 9 conversations, Messenger = 7, Instagram = 2, WhatsApp = 0. Diagnostics show Conversations/Unresolved/Handovers = 0; response/acceptance/automation unavailable. No `marketing_inbox_analytics` console errors. No business conversation was opened or command submitted.
- Reuse the completed 50-test Conversations Staging suite and responsive/provenance/media fixture acceptance. There is no frontend delta, so no broad UI rerun or new application build is required to validate this database correction.

## Smallest Production release (approval required)

Base: current Production main/live `ad20732e5dc5426a1139c28322589b45352ca137`. Runtime scope: one guarded forward migration replacing one validation clause in `marketing_inbox_analytics`; no frontend changes, Edge bundles, credentials, permission changes, provider settings, fixtures or business mutations. Supporting source consists of this evidence guide, the canonical Marketing contract and the isolated SQL regression test.

Before approval execution, recheck main/live and the exact old RPC fingerprint. Apply only the reviewed migration, record its exact ledger receipt and verify authenticated All/FB/IG/WhatsApp reads and existing ACL. Source integration to main is separate from database execution: publishing the approved source commit through main's existing Git integration will produce its normal build even though no application source changes. Do not manually deploy another frontend or Edge bundle, replay historical SQL, alter flags or force ledger equality. WhatsApp onboarding, Staff Reply, AI and campaigns remain disabled.

If verification fails, stop. Any rollback needs separate approval and a forward correction restoring only the reviewed validation clause; never delete an applied migration or roll back unrelated WhatsApp UI/backend work.
