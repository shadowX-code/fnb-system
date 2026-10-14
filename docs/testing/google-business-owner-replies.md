# Google Business Profile Owner Reply Verification

QA L3: new service-only reply lifecycle, external write intent and cache projection. Staging project is `ujkzdaaadnvcfayuldmh`. No Production deployment or real Google reply is part of implementation QA.

## Authorities

- `20261014130653_google_business_owner_replies` adds private encrypted reply requests, the scoped reply permission helper, service-only reply lifecycle RPC, and independent content purge.
- `20261014132350_google_business_reply_write_guard` adds the final permission/mapping/generation/lease guard. It is a forward migration; the applied first migration is unchanged.
- Shared `googleBusinessReplies.ts` uses only fixed official GET-review and PUT-reply paths, reuses the encrypted OAuth token lifecycle, and exposes no token/client-secret material to browsers. A write is never automatically retried.
- Request fingerprints prevent ID reuse with different text/basis. Active leases and unresolved outcomes serialize one review. Check Status cannot perform a PUT. Raw encrypted content has a 24-hour purge; audit actor/action/outcome/source/fingerprints remain.

## Controlled verification

`qa/staging/googleOwnerReplyMockCases.ts` is a pure synthetic transport suite. Its fetch implementation never delegates to the network and never calls database authorities. It covers multilingual publish/update, lost-response reconciliation, a failed reconciliation followed by safe status retry, permission rejection, exact 429 service/request reporting without retries, remote conflicts, Google moderation, lost audit acknowledgement, expired authorization, failed read preflight and authority drift. The same suite is tested locally and run inside a temporary Staging verification Edge Function; delete that function after collecting the synthetic-only report. No mock flag or arbitrary provider URL exists in the operational gateway.

`qa/staging/googleBusinessOwnerReplies.rollback.sql` runs under an explicit Staging fixture marker and rolls back mappings, role assignments, reply intents and audit rows. It checks browser grant denial, selected-outlet reviewer/read-only access, foreign review rejection, changed ID fingerprints, lease/intent serialization, final guard denial after permission revocation, auditable finish after revocation, idempotent outcomes, exact cache patch/expiry preservation and content purge.

The UI tests mock the service boundary for explicit confirmation/cancel, multilingual text, byte limits, duplicate submit prevention, retained drafts, uncertain status reconciliation, remote conflicts, viewing-only access and pending moderation. Authenticated canonical Staging checks open real detail read-only, inspect the editor and confirmation, then cancel; do not click its final publication action.

## Remaining release verification

A real official PUT has deliberately not been exercised. Before doing so, obtain explicit approval identifying the exact review/outlet and reply text. Preserve the current OAuth client, mapping and server credential architecture. Production requires separate authorization and its own configuration/release preflight.

## Confirmed reply read-back regression

The `yap dason` Staging publish records `reply_saved` at 2026-10-14 13:47:19 UTC with encrypted Google reply evidence. A subsequent authenticated GET returns the same reply, `Thanks`, with timestamp precision truncated from PUT `13:47:19.177320Z` to GET `13:47:19Z`; identical text is reconciled despite timestamp precision. The original missing-reply GET response was not retained, so read-after-write propagation lag is inferred rather than proven from historical wire logs. The confirmed patch/audit were intact; Detail previously replaced the accepted reply unconditionally with GET data and never consulted its confirmed evidence.

Forward migration `20261014135852_google_business_reply_readback` exposes only service-role scoped, current-generation/current-mapping, unexpired confirmed reply evidence. Shared reconciliation protects Detail/Inbox/sync and blocks a pre-write GET that regresses behind it. Mock writes cover update/errors/uncertainty plus a lagging read that performs zero PUTs; SQL fixtures roll back and verify mapping/expiry exclusion. Actual Google reply verification remains GET-only.

## Post-update read-back UX

The 15 Oct update was accepted at 00:52:42 MYT; logs at approximately +2s and +20s still returned the original 21:47:19 reply with different text. This is genuine stale read-back, not timestamp precision. Detail formerly performed one read and retained a separate success banner alongside its pending warning. The bounded client read coordinator now reconciles automatically, caps reads, stops on provider errors, cancels after close, and keeps one final feedback state. Mocked UI writes verify stale→fresh, exhausted retries/manual recovery, drafts, no duplicate PUT, and read failure. Authenticated Staging verification remains Google GET-only; no new real write or audit intent is allowed for QA.
