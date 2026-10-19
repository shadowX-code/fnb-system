# iPhone foreground recovery audit — 19 October 2026

Baseline canonical Staging: `08bc38b587ebe3d141fcb2f5a5694bc047e9f859`.

## Already implemented

Continue starts fresh getUserMedia, Web Audio resume and HTML playback priming synchronously in the tap, before unrelated awaits. Live/unmuted camera and microphone validation, bounded setup stages, server CAS recovery ownership, fresh provider generations, canonical continuation context and cold-bootstrap recovery already exist. Stale generation callbacks are fenced. Recording units and old uploads recover independently; interruption records a gap. None of these authorities was replaced.

## Confirmed gaps and correction

- No persisted-pageshow handler: a Safari page-cache restore could retain apparently resumed or recovering client ownership. Persisted restore now invokes the existing interruption path, clearing busy ownership and exposing Continue without refresh.
- Resolved HTML play plus an open data channel could acknowledge Connected without explicitly checking live remote audio and connected WebRTC state. Both are now required with a bounded readiness wait, checked again after the server acknowledgement.
- Remote audio track end between responses was unobserved. It now triggers the single recovery surface. Synchronous native play exceptions enter the same failure path rather than escaping the track callback.

These are reproducible source-level gaps, not proof that either caused every historical physical failure. Historical logs did not establish a failed native acquisition for the latest two provider generations. No historical transcript, recording, annotation, report or configuration was changed.

## Focused verification

Three initial regressions failed on the baseline (persisted restore, dead remote readiness, remote track end). After correction, 51 tests in six focused files pass, covering cold refresh, foreground, pending old uploads, stale tracks, native denial/hardware rejection/hang, synchronous native activation ordering, repeated Continue, hung provider/peer, late callbacks, track loss during server acknowledgement and recording recovery. Vite build and diff whitespace check pass. No provider API, SDP payload, backend contract or model behavior changed; the prior real-provider continuation verification was not repeated. No synthetic interview data or assessment results were created in this audit.

An open remote track and successful playback setup are readiness observations, not proof of audible output. The provider may not emit packets before entry speech, so waiting for remote unmute before requesting entry could deadlock. Physical iPhone Safari remains mandatory and unverified in this environment. Do not certify candidate readiness from these tests.

## Physical Safari acceptance

Use an isolated synthetic QA invitation on canonical Staging, never an original failed attempt or real candidate. Record the iOS/Safari version and deployment SHA.

1. Start in Safari with ordinary phone audio; permit camera/mic. Answer two questions. Note the last question and a distinctive factual answer.
2. Go Home for 15–30 seconds, return to Safari. Expect one Continue interview action and a disclosed interruption; no apparently active recording with disconnected interviewer.
3. Tap Continue **once**, without refresh. Native media/audio activation must begin in that tap and visible preparation stages must advance. Expect a fresh preview, recording unit and provider generation on the SAME attempt, then an audible relevant continuation without replaying the welcome or covered questions.
4. Answer two further questions. Repeat Home/foreground once, including while AI speaks. Old callbacks must not stop or restart the new generation.
5. Refresh during the resumed interview. Expect clean Continue; one tap reconstructs fresh media/recording/provider from the same durable attempt.
6. If setup fails, it must return to Continue with a useful error within bounded stages (native capture 15s, track readiness 5s, provider setup 25s). A retry must work without refresh. Denial wording must appear only for actual permission denial.
7. Stop and save partial through confirmation. In Admin, verify same attempt, prior eligible transcript/coverage retained, new provider generations/recording units and explicit gaps. Recording may truthfully be Partial; never infer continuous background capture.

PASS requires audible, coherent continuation after the first tap in both foreground and cold-refresh cases. Camera-only recovery, silence, repeated opening, a stuck pending stage or refresh as a workaround is FAIL. Save the attempt/time of any failure for bounded diagnostics. Human listening is required; browser play receipts do not certify hearing.
