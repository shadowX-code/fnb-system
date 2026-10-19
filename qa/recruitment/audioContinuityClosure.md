# Audio continuity correction — Staging only

## Primary evidence

Attempt `814a100c-9d8b-42a0-a2ad-6e772622eba3`, 26 durable turns, two provider generations. Its immutable configuration is Service Crew **V2**, not V4 (`1b1972fe-47aa-4856-9532-0fbc39ef9b3e`). Generation 1 has four clear events, no audio drain or orientation receipt, and an explicit `orientation_audio_timeout` about 15 seconds after its orientation tool call while output is draining. Generation 2 has seven clears, one drain, no orientation receipt and four client response requests (entry plus three tool continuations). All eight generation 2 AI utterances repeat the opening. Eleven candidate turns are annotated unverified. The microphone source of those transcripts is not established by these events.

The legacy controller required a model tool attached to the same fully drained opening response. Missing/interrupted/tool-only responses left that gate pending; a negative tool receipt requested another opening. Persisted continuation reconstructed the same gate. Native HTML playback was first started only after async provider negotiation; activated Web Audio alone was treated as sufficient. Late native playback promises and unscoped audio-stop events could affect subsequent state. Transcription delta diagnostics were incorrectly labeled failed; this was diagnostic noise, not proof of failed final transcription.

## Correction

`continuity-v2` removes the orientation tool/gate from new sessions and keeps automatic provider responses and interruption. First entry and quiet context updates have separate presentation semantics; replacement sessions always receive eligible durable continuation. HTML playback is gesture-primed, remote playback readiness is bounded before entry, and generation ownership prevents stale cleanup/rejections from affecting the newest source. Completed response/drain observations are recorded as dialogue checkpoints without certifying hearing. Repeated uncertain input converges to recovery rather than replay. Existing evidence exclusion, recording/finalization, consent and hiring contracts remain unchanged.

## Verification

L2 workflow checks: 114 focused tests across 11 files and Vite build passed. The original generation-1 control boundaries reproduce the legacy orientation timeout and no longer produce it under the new protocol. Tests cover provider-owned replies, thinking pauses, short answers, stale/duplicate responses, genuine interruption, uncertain input, playback rejection/cancellation, old native events, fresh recovery, ordered/excluded evidence and submission/recording reconciliation.

A protected synthetic-only application exercised real `gpt-realtime-1.5` on Staging: one opening, two spoken synthetic answers with automatic distinct follow-up responses, followed by a new provider generation on the same attempt. Its context retained café experience and part-time/start availability. The replacement entry continued the unresolved start-date question without repeating the opening. No recovery or duplicate response IDs were observed. An initial literal `part time` harness check rejected provider `part-time` spelling; the corrected oracle validated the retained provider output without another run. WebSocket drain receipts were modeled, not physical playback observations. No genuine candidate invitation or assessment report generation was performed. No-camera synthetic recording units were explicitly marked invalid and finalized as Failed.

## Remaining physical limitation

No controllable physical iPhone Safari/Chrome surface was available; `devicectl` is not installed. Acoustic echo, browser routing, audible output and real background/native permission behavior are not certified by the synthetic run. Echo/noise constraints remain browser capabilities, now recorded from actual track settings. The conservative repeated-uncertain-input recovery can also affect genuine repeated barge-in. The implementation is Staging-ready for physical validation, not certified ready for real candidates.
