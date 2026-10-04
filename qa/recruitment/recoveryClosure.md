# Recruitment V1 recovery correction — Staging evidence

Status: focused canonical Staging technical verification passed on `6aaf1f9db3ee06db553c7a2d63612d2b6655d477`. Physical reacceptance and regional voice judgement remain pending. No Production authorization.

## Investigation before changes

Original failed attempt: `ed2cac1c-f049-4608-bb4e-acc882043dc4`, application `2082f00c-cdf4-499e-a161-40a6fcf19094`.

- Started 4 October 2026 11:35:38 MYT; one provider generation connected 11:35:45. No provider replacement occurred during the failed conversation.
- Durable transcript contains 42 ordered messages, several interrupted AI phrases, repeated requests to repeat questions, and short candidate items transcribed in unexpected languages. These are transcription observations, not evidence of those candidate languages or a candidate weakness.
- One MP4 recording unit stopped at 11:41:54 because of `page_backgrounded`; it remained Pending. The gap was stored. No subsequent recording unit/provider session followed. A much later resume at 12:31 entered Finalizing because the 10-minute wall-clock deadline had elapsed.
- Original storage lacks response IDs, raw VAD/EOS and browser playback events. Therefore it cannot establish every individual mobile speech glitch or prove acoustic echo as the cause. The original attempt/data was not rewritten.
- Unchanged-build synthetic reproduction captured response `resp_EV9NL7Xu2EtVwCrUcp05e`: one `response.created`, two message outputs (`commentary`, then `final_answer`), and two output-buffer starts. The commentary spoke a thinking preamble before a substantive rephrased question. There was no second client response creation and no tool call for that response. This concretely reproduces split speech within one reasoning-provider response, rather than proving duplicate client creation caused the original pair.
- Code inspection found new random client identity on refresh, no same-tab recovery identity, blocking prior uploads before new capture/voice, background time consuming the deadline, unguarded asynchronous tool continuations, concurrent reconnect entry points, and stale credential/ontrack callbacks. Those are corrected in their owning layers; no arbitrary conversational silence delay was added.

## Corrections

- Same tab retains an opaque client UUID under a hashed invitation partition; Web Locks deny duplicate tabs and the existing server lease denies other devices. Replacement transport is single-flight, closes old playback, and rejects stale async credentials/channel/track callbacks.
- Explicit pause persists a server timestamp. Resume preserves remaining active interview time (bounded by invitation expiry), transcript, pinned configuration, coverage/scenarios/unresolved items; a fresh server-approved provider context contains bounded recent conversation, covered-topic statements, opening and remaining time. Truncated AI utterances are excluded.
- Visibility/pagehide, muted/ended tracks and suspended recording audio context pause truthfully. Resume reacquires media, creates a new recorder unit and records a gap. Prior upload recovery runs separately. A missing recorder stop acknowledgement cannot hold recovery indefinitely or imply a valid trailer.
- `gpt-realtime-1.5` is used for non-reasoning speech conversation. Semantic VAD remains Low; provider automatic response creation/cancellation are disabled. One controller owns requests by committed input item, cancels/clears barge-in, waits for generation and playback completion before tool continuation, and ignores late tool ownership. Closing waits for the particular permitted closing response.
- AI finalized text is saved after output-buffer playback completion. Interrupted/uncertain text retains a truncation annotation rather than fabricated word-level alignment. Browser output completion does not independently attest human hearing; recording remains the review evidence.
- Private bounded diagnostic batches retain response/item IDs, owner, VAD/EOS, lifecycle/cancellation/playback observations and elapsed time. No prompts/transcripts/audio/credentials are included. Direct table access remains revoked.
- Recruitment presentation v1.1 specifies contemporary Malaysian restaurant English rhythm; built-in Marin and Cedar samples are retained privately for actual listening. Regional quality is not certified automatically.

## Focused verification so far

- 28 relevant local tests: response ownership/playback/tool races, stale credentials, refresh/foreground UI, existing recording receipt recovery, consent/prompt regression and report evidence-health consumer. Production build and diff check pass.
- Disposable local PG17 plus Staging rollback contracts: paused budget, same attempt/transcript/coverage, duplicate client, stale provider generation, established-fact/recent context, revocation, diagnostics retry/grants/payload bounds. No persistent contract fixtures.
- Corrected local UI with real Staging backend/OpenAI: 3-second mid-answer thinking pause generated no extra response; barge-in truncation; immediate refresh without 45-second wait; duplicate-tab denial; background signal closed all channels; explicit resume; independent AI reconnect. Same attempt `752d11fc-13a8-4cbc-8d55-59b66dfef707`, four verified 640×480 units, explicit gaps and truthful Partial classification. Original reasoning-model split was absent in eight captured replacement-model responses. This run includes a corrected synthetic microphone setup and is not physical-device validation.

Private raw synthetic timelines/media/receipts are under `/private/tmp/feedx-continuity-baseline`, `/private/tmp/feedx-continuity-recovery` and `/private/tmp/feedx-voice-{marin,cedar}`. Tokens and signed URLs are omitted from Git.

## Canonical Staging verification

- Git-integrated deployment `dpl_7Vt87V3Sim9naLuCtzwinnSxEp8P` is READY in `fnb-system-staging`; canonical dev/origin/dev/deployment matched. Both scoped recovery migrations and the realtime Edge Function were delivered to `ujkzdaaadnvcfayuldmh`.
- Real-provider canonical browser run: application `e82b19ca-245c-40e1-8515-24001cadf1ad`, attempt `65da25dd-2d4c-459e-8778-23709a1da1eb`. Four connected provider generations cover initial voice, refresh, foreground return and independent realtime reconnect. Three independently verified 640×480 MP4 units survive; AI-only reconnect adds no recording unit. Three disclosed gaps produce Partial, not Complete.
- A three-second mid-answer thinking pause generated no premature response. Barge-in produced one provider truncation; refresh immediately offered explicit media resume; duplicate tab was denied; simulated page background closed transports before explicit foreground resume. Five completed captured provider responses each contained one message; a sixth was cancelled. Eight response requests/creations have matching ownership, no captured provider errors and no commentary/final-answer split.
- Bounded durable traces contain committed/VAD events, response IDs and owners, cancellation/buffer clearing, playback and transport observations. Manager review displays ordered retained transcript, two uncertain/interrupted annotations, Partial evidence, three gaps and source-pinned ready AI report with unresolved collection evidence. All three manager video elements loaded 640×480; recovered unit 3 played through its 35.4-second end. This is metadata/playback verification, not human acoustic judgement.
- Raw synthetic canonical evidence and manager screenshot are private in `/private/tmp/feedx-canonical-recovery`. Browser background was simulated; physical OS media suspension and mobile audio quality still require the six-scenario reacceptance in `v1RecoveryAcceptance.md`.
- Original failed evidence is retained. No manager hiring decision or Employee was created by this correction QA. No Production/main or DNS action was taken.

## Human reacceptance

Physical iOS/Android refresh, app switching, device reacquisition, pause/barge-in quality, repeated recording-unit integrity and regional voice must be judged by a human. Previously observed Safari invalid later units remain a real limitation; preserve valid prior units and Partial evidence. No continuous background capture or seamless recording is promised. No Employee/Hire/Production action belongs to this acceptance.
