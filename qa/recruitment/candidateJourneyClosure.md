# Invitation-to-interview journey verification

## Scope / QA level

L3, scoped to application invitation presentation, candidate preparation/room/completion presentation and preparation-only starting language. No realtime controller, recording authority, Profile intelligence, evidence assessment, report or hiring redesign. No Production/main delivery.

Implementation: `86e2dc2f` integrated into canonical dev as `e8de77ba5c6228b0a107914448700084ace17370`, followed by focused browser-discovered consent styling and invitation expiration/clipboard-receipt fixes in this closure commit. The canonical Recruitment domain document owns the durable contract.

## Contract verification on Staging

Project `ujkzdaaadnvcfayuldmh`; forward migration `20261005123200_recruitment_candidate_language.sql` applied once and ledger matched. Staging `recruitment-realtime` function deployed with only canonical preference/context additions.

`candidateLanguage.rollback.sql` ran successfully on Staging with rollback: all four preferences, invalid input/token, revoked/expired token, preparation-only mutation, pinning after start, cold entry/reconstruction preservation, unchanged versioned consent, direct update grants absent and RLS/PUBLIC EXECUTE boundaries. No real applicant or historical acceptance evidence changed.

## Focused regressions / build

- Candidate journey, provider-owned conversation adapter, transport generation, iOS recovery fixtures and launch: 63 tests pass across five suites.
- Existing Phase 2 scoped contracts: 10 tests pass.
- New Admin invitation journey and expiration race: 8 tests pass; unrelated workspace tests excluded.
- Production bundle build passes; existing large-bundle advisory remains.
- `git diff --check` passes.

Tests verify preparation server gates, permitted identity correction, pinned language context, presentation events (without response creation), provider-owned turn ownership, fresh-generation recovery and immutable evidence boundaries. Admin tests verify optional post-registration issue, application ownership, hash-only URL limitation, and all five overview deep-links.

## Real-provider language probes

One clearly named synthetic candidate was registered through authenticated Staging Admin in an existing QA Service Crew opening. Reissue used the established protected invitation workflow. Existing human/failed interviews were preserved. No hiring or Employee conversion.

Native WebSocket probes used a Staging-approved ephemeral OpenAI credential and canonical `gpt-realtime-1.5` instructions. Provider automatic response and interruption flags were verified. Only interview entry used explicit response creation. Ordinary synthetic PCM speech relied on provider turn detection; a distinct completed AI response ID and actual spoken transcript were required per finalized answer. Actual finalized synthetic transcript was relayed through existing evidence RPCs. No video was fabricated: synthetic recording units were preserved as Invalid and final evidence truthfully failed recording.

- EN: English greeting, transcribed answer and relevant automatic response.
- BM: Malay greeting, transcribed answer and relevant automatic response.
- Mandarin: Mandarin greeting, transcribed answer and relevant automatic response.
- EN → BM → EN: provider switched appropriately.
- Mandarin → EN → Mandarin: explicit candidate requests respected, with relevant automatic responses after each switch.
- Cantonese: Cantonese greeting/audio produced, Cantonese speech transcribed accurately, relevant Cantonese follow-up in the Cantonese-only probe.
- EN → Cantonese: explicit switch respected, but one mixed-language answer paraphrased the candidate's closing-time constraint inaccurately before asking for clarification. This is a model factual-quality limitation, not proof of complete Cantonese comprehension.

These are synthetic provider exchanges, not WebRTC/iPhone microphone, playback, accent or naturalness acceptance. Cantonese pronunciation/naturalness has **not** passed human listening. Raw provider/audio diagnostics and private fixture token are retained only in `/private/tmp/feedx-candidate-journey`; credentials/tokens are not committed.

## Browser / visual verification

CUA browser review used local canonical-source UI against real Staging preparation contracts. Widths 375/390/430, tablet 768 and desktop 1280 reviewed without horizontal overflow. Checked all four language buttons, compact identity Edit, persisted consent, disabled Start without usable media, bounded device failure/retry, cold durable recovery surface with one Continue interview action, and completion with canonical timestamp. No candidate provider/session/coverage controls.

A clearly labelled development visual fixture imports the real Room/presence observer/Complete components. It covers CJK/BM/EN prompt layout and event-driven Listening/Thinking/Speaking/Recovering at mobile/tablet/desktop widths. This fixture has no media, provider, token or business mutations and is not live-interview evidence. Reduced-motion CSS disables room animation/transition; the OS setting was not independently emulated.

Browser camera acquisition was unavailable in this test browser and returned a bounded retryable device error. Therefore real devices-ready meter/PiP/Start/recording playback and a physical full journey remain **unverified**, not simulated PASS.

## Delivery limitation

Vercel Git Integration rejected `e8de77ba...` with “Deployment rate limited — retry in 24 hours.” No repeated build submission, manual Preview, alias promotion, project change or Production deployment was made. At inspection, canonical Staging alias remained READY on `4b909cba088f9d0f384d97a6361b421400f86f28` (`dpl_5m6KZ5ZWQjdHJRjSRsKTRDQHqa2x`).

The migration/function are backwards-compatible with that UI. Final canonical dev must be delivered when quota permits and verified against the Staging project/alias before claiming full delivery. Changed live Admin optional issue/Copy/Open/Revoke/Reissue and overview deep-links, plus physical camera-ready end-to-end room/completion/review acceptance, remain pending that deployment. No fresh human acceptance invitation is issued while the changed UI is not READY.
