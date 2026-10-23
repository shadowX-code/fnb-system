# WhatsApp Conversations UI — dormant Production candidate

Status: prepared locally; Production deployment requires separate approval. The release receipt identifies the exact candidate commit. Branch: `codex/whatsapp-conversations-production-rc`.

## Baseline and release scope

- Production `origin/main` and `os.feedx.my` live Git deployment: `cd3e3a70fcd72d6d60d21b86ff3faf96138d3a0d`.
- Current live deployment: `dpl_D5EkgJoBkGN8QrvDgrynhhRqF8dc`, READY, project `fnb-system` (`prj_1UOKHvE6Ft4a2WXrZyZGc9LZRWLP`).
- Verified Staging source: `f5f2a67fbc1e13422a0cbbb491ceca36fd123fe0`, READY Git deployment `dpl_HvQm1iWG38wukC4oL1DPHzApkmSG` on `fnb-system-staging`.
- Runtime changes: `MarketingInboxPage.jsx`, `InboxReplyComposer.jsx`, `WhatsAppMessageContent.jsx`, `inboxKnowledge.js`, `inboxPresentation.js`, `marketingInbox.css`, all under `src/features/marketing/`.
- Supporting changes: deterministic local-only Inbox fixtures, focused UI tests, the canonical Marketing presentation section, UI acceptance guide and this release packet. No fixture route or fixture data is part of the application build.

This is a scoped patch on current Production main, not a merge or promotion of all Staging changes. Production's newer Planner/shared timeline work remains in the parent. Production FB/IG message footer attribution remains `Meta`; Staging's broader sender/interaction labels are not imported. The insertion-sequence tie-break is limited to WhatsApp, preserving existing FB/IG ordering.

## Dependencies and disabled boundaries

No migrations, SQL execution, Edge bundles, API handlers, credentials, environment settings, flags, Meta configuration or package changes are required. Canonical Inbox services, read models, storage, Brand permissions, routes and shared controls remain unchanged. Existing Production runtime-aware origins, OAuth routing, encryption, provider identity, privacy, worker and scheduler authorities remain byte-identical to the parent.

WhatsApp Staff Reply, AI Suggested Reply, automatic FAQ preview and AI resume remain disabled in the UI independently of general sending/AI flags. Existing backend WhatsApp send/onboarding/AI/campaign gates remain unchanged. Authorized team notes use the existing authority. This candidate seeds no approvals, binds no phone and imports no history. Media stays a safe typed placeholder; no media URL, download, playback or retrieval is introduced. Mobile echoes are observations outside FeedX, not a provider delivery receipt.

## Verification and reused evidence

QA level: L2 release preparation. Reuse the completed 50-test Staging suite and desktop/mobile browser evidence from the UI source SHA. The acceptance guide is [WhatsApp Conversations UI](../testing/marketing-whatsapp-conversations.md). Populated timelines are isolated renderer fixtures, not synthetic business records. Staging browser acceptance verified the real empty WhatsApp list, authorized Brand filtering, disabled onboarding explanation and responsive layout; real numbers/provider receipt acceptance were intentionally excluded.

Candidate checks cover the Production-only reconciliation seams: WhatsApp provenance/fallbacks/disabled controls, canonical timestamp ties, unchanged FB/IG tie ordering and existing external-Meta attribution. The candidate frontend build and `git diff --check` must pass. The release receipt records results and hashes of every changed file. No broad QA, provider calls or Production data queries/mutations are needed for this frontend-only preparation.

## Approval and execution scope

After explicit approval of the exact RC SHA, re-fetch `origin/main` and re-read the live Production deployment. Both must still equal the baseline above; unexpected drift requires reconciliation and a newly approved successor RC. Confirm the candidate remains one scoped commit above that baseline. Push the exact approved candidate once to `main`, allowing the existing `fnb-system` Vercel Git integration to build it; do not deploy with CLI/API, promote Staging, alter aliases or push an unrelated integration branch. Verify READY, exact SHA and Production alias assignment.

Focused Production acceptance is read-only: open canonical Conversations, verify WhatsApp channel/Brand empty state, confirm existing FB/IG list presentation and Connections' disabled WhatsApp readiness. Do not open unread business conversations (opening marks them read), submit notes, click verification/Connect, start OAuth, send, call AI or execute campaigns. Report the final SHA and scope. No real-number binding, WABA subscription or Meta mutation is authorized by the frontend release.

## Rollback scope

Rollback requires its own explicit authorization; never silently revert after failed smoke. Preferred rollback is a Git revert of only this candidate commit on then-current main, followed by the same canonical Git deployment, preserving any later releases. It removes only the six frontend presentation files/changes and supporting tests/docs/fixtures. No database, Edge, credential, receipt, history, connection, CRM, permissions or worker rollback applies.

If no later Production release exists, the exact pre-release frontend is `cd3e3a70fcd72d6d60d21b86ff3faf96138d3a0d` / `dpl_D5EkgJoBkGN8QrvDgrynhhRqF8dc`; restoring that deployment is a separately authorized emergency alternative. Do not restore this whole baseline over newer Production work. Existing dormant WhatsApp backend safeguards remain in either frontend state.
