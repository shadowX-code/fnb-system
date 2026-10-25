# WhatsApp receive lifecycle successor — dormant Production candidate

This candidate supersedes stopped RC `05c3c36b5807347ae639c305d732b25b4fe655eb`, on Production main/live `440d04a409f39001cef7c72b524b689f58f45009`. Production remains unchanged: ledger 868/latest `20261024150847`, marketing-inbox v37/bundle `ad7d216da23e5e63bb46a1f547170521efab64207c2a90de02f24d5a8c2e1eb3`, zero WhatsApp connections/readiness/pilot approvals. Preparation is not authorization to deploy.

## Missing dependency and compatible correction

| Contract | Actual Production | Actual Staging | Successor |
|---|---|---|---|
| Message table owner / RLS | postgres / enabled; no direct authenticated table access | postgres / enabled; same table grants, policies and trigger definitions | Preserve Production security |
| provider_context | Absent; no current Production function reference | jsonb, NOT NULL, default '{}'::jsonb | Add the same internal column |
| Size constraint | Absent | octet_length(provider_context::text) <= 8192 | Same constraint |
| Column ownership | No separate column authority | Created by 20261019030353_marketing_inbox_automation_ownership.sql | Dedicated compatibility migration |
| Writers/readers | Existing originals omit this column | Staging worker stores bounded app/interaction context; WhatsApp correction helpers use target identity | Only reviewed WhatsApp corrections write context; no FB/IG writer change |
| Whole-row detail/audit JSON | Would expose any newly added column | Broader Staging read contract | Exclude raw provider_context, preserving exact existing FB/IG responses |

The existing eleven message column definitions are identical between environments. Staging additionally has the context size check, applied edit/revoke kind allowance, lifecycle partial index and unrelated external-echo index; the latter is not imported.

The compatibility migration does not backfill or update original bodies, timestamps, provider IDs, sequence, provenance, credentials or connection ownership. Existing rows and future inserts omitting the column receive an empty object. It installs no automation command, extra connection metadata, echo index, permission or API signature. A guarded detail-body replacement preserves the canonical caller checks, grants and owner. The already-reviewed lifecycle migration remains byte-for-byte unchanged.

## Exact release order — separate approval required

Use only this allowlist, with exact source-version receipts, in one guarded transaction. **Compatibility executes first despite its later generated timestamp.** Do not sort the directory, run broad db push, replay aliases/applied history, rewrite timestamps or force ledger equality.

| Order | Migration | SHA-256 |
|---|---|---|
| 1 | 20261025011621_marketing_whatsapp_receive_context_compatibility.sql | 34b5ed71171fd6e63c3fe879b6acafd1c0b381c98d72897142b9e7c892c3cf27 |
| 2 | 20261024185401_marketing_whatsapp_message_lifecycle.sql | 7a2f3c1cf3631fdf9040c5288fb81c54e93c7b7736e2805366bbf787d72ec990 |

Recheck exact main/live, ledger, missing-column baseline, message constraints, four affected authority definitions/ACLs and deployed Inbox bundle; stop on drift. The expected ledger becomes 870/latest `20261025011621`. The failed release left no receipt and needs no history repair. Staging already owns the column through its applied automation migration; do not execute this Production-only compatibility SQL there or use it to force ledger equality. Future source-history integration must preserve Staging’s separate broader projection contract.

After SQL, deploy only marketing-inbox using its **current Production** 18-file source bundle: replace the entry point and two WhatsApp helpers; preserve the other fifteen dependency bytes. No marketing-meta or marketing-worker deployment. The manifest pins every old/new file hash and the reviewed source-set digest; the next provider bundle hash/version must be verified after an authorized deployment, not predicted. Then release the exact approved successor SHA through canonical Vercel Git integration. Frontend scope remains the two reviewed WhatsApp provenance labels; no additional UI or dependency change was needed.

## Focused verification

Fresh read-only metadata captures reconstruct 144 related tables and 416 function definitions on isolated local PostgreSQL 17.6, matching Production's version. The baseline includes defaults, column types, primary/foreign/check constraints, indexes, triggers, ownership, table RLS/policies/grants, function/schema/default ACLs and permission-code metadata. No Production business rows or secrets are copied. The runner verifies captured function definitions exactly and first reproduces the original missing-column SQLSTATE 42703 under a savepoint.

The complete ordered sequence passes on that baseline. Synthetic pre-existing FB/IG incoming/echo and delivery/read evidence retains original row content; authenticated detail (including receipts) and list responses compare equal. Column default, null/8-KB rejection and denied direct client access pass. Existing function grants/owners and table security remain unchanged; only the same four reviewed existing authorities change. Broader Staging ownership authorities remain absent, and independent WhatsApp sending/AI denials remain in place. The full canonical receive fixture passes: early and out-of-order edits/revocations, immutable originals, peer/Brand/phone/direction/generation fencing, duplicate/malformed siblings, chronology/search and absent CRM/consent/AI effects. All synthetic records and SQL roll back locally.

Three signed HTTP fixtures also pass against the **exact assembled Production source bundle**, with Production runtime identity, mocked durable RPCs and provider networking forbidden: valid siblings survive malformed items, invalid signatures/JSON fail closed, and durable failure remains retryable. All fifteen retained dependency bytes were verified. Reuse Staging 3be25957d's 70-test L3/build/browser evidence and the stopped candidate's 68-test/build evidence; app/Edge sources are unchanged. No broad QA or live provider test is repeated.

The reproducible local runner is `qa/release/rehearseWhatsAppReceive.mjs`; the source snapshot hashes and results are pinned in the [manifest](2026-10-25-whatsapp-receive-successor-manifest.json). Production metadata is inspectable in the local capture directory; it is not embedded as a full schema dump in Git. This is a faithful scoped schema/authority rehearsal, not a copy of Production business data or its managed service runtime.

## Rollback and disabled scope

Rollback mutations require separate approval. A governed frontend/Inbox Edge rollback can restore the prior application bundle while leaving additive dormant SQL. Keep provider_context, its detail/audit serialization exclusion, new kind allowance and append-only correction evidence once installed; restoring old whole-row JSON would expose the internal column. Any database repair must be a reviewed forward correction preserving grants, identity/generations, deduplication, immutable originals, privacy erasure and once-only synchronization receipts. Never delete correction evidence, replay synchronization, offboard a provider or activate execution as recovery.

Onboarding, history promotion, Staff Reply, AI, campaigns and outbound execution remain disabled. No platform or pilot approvals are seeded. Official Meta eligibility, one-Brand pilot authorization, history consent/retention and importer acceptance remain separate prerequisites from this dormant correction.
