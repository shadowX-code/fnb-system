# Session recovery ownership — 28 October 2026

## Physical evidence and first failed boundary

Attempt `d5110bc5-4dee-4c89-b428-40937883e828`, published Service Crew V4,
configuration `3507cef6-ef1c-4fd1-8b48-9ae69598a15d`:

- First generation reached RESUMED and collected 18 durable transcript turns.
- 28 October 01:55:13 MYT: background observation, RECOVERY_REQUIRED and provider
  close. Recording unit 1 remains verified: 11,030,812 bytes; its actual ending
  records page_backgrounded. Two recording-gap events remain present.
- Continue `ad129680-8f4d-42b3-b485-f37195c8d78a` at 01:56:08 reached native
  capture/activation. getUserMedia later reported recovery_timeout at 01:56:36.
  This confirms failed media acquisition; the old trace does not distinguish
  every synchronous native call or establish why execution took ~28 seconds.
- Retry `becc03aa-5bb8-42ae-914c-81b1d5486ecd` obtained live audio/video, running
  audio, server continuation, local transcript and recording unit 2. The last
  observation is fresh AI session / dependency_started at 01:56:47.
  Provider generation is 2 and server state remains starting. No WebRTC/playback
  success, terminal timeout or error was retained. It is not defensible to claim
  whether authorization, SDP, peer readiness or remote playback stalled.
- Unit 2 remains Capturing/unfinished; no media or continuity is fabricated.
  The old diagnostics were memory-only until network acknowledgement, so refresh
  could lose the missing failure. The black screen itself has no paint telemetry.

The privacy-safe control sequence is retained in
`sessionRecoveryPhysical.fixture.json`. No candidate transcript/audio is copied.

## Confirmed architectural gaps corrected

The existing transport machine was already a helper outside the Room. However,
the async native/server recovery transaction still lived in React closures, its
pending UI was batched before native activation, and the Continue/error surface
remained under the live Room subtree throughout recovery. Native teardown calls
could throw before retry publication. These are distinct from provider VAD,
automatic turn acceptance and Interview Profile intelligence.

- One route-level Session Recovery Controller owns the transaction, native
  resources, tab claim, generation fence, lifecycle listeners and state snapshot.
  It inherits the existing transport helper rather than allocating another owner.
- The Room is disposable; recovery is a plain surface with no old camera node or
  animated Room. Room render errors are contained outside the recovery surface.
- The first tap synchronously commits pending UI before fresh capture/audio.
  Retry can supersede an old pending operation; stale callbacks cannot close or
  publish over replacement ownership. Native cleanup failure cannot retain busy.
- Same server attempt/continuation, recording units, transcript and profile pin
  are preserved. Existing bounds are retained; no delay/replay workaround added.
- Running native audio plus existing peer/channel/remote playback readiness and
  foreground state are required before mounting a fresh Room.
- A synchronous, privacy-filtered sessionStorage journal retains the last native
  checkpoint and correlation across abrupt refresh; delivery to the existing
  protected observation RPC is independent from evidence upload/IndexedDB.

## Focused verification only

Lifecycle tests cover committed first-tap feedback before capture; no old Room
while pending; background/foreground and cold reconstruction; stale callbacks;
repeated retry with one tab claim; hung/rejected media and provider dependencies;
throwing native cleanup and remote attachment; running audio readiness; truthful
capture/gap behavior; Room failure containment; journal privacy, bounded storage,
failed delivery and original-key replay after refresh. Existing recording,
playback, device and transport-generation lifecycle tests remain included.

The focused gate passed 77 tests in seven lifecycle files and the production
bundle build (existing chunk-size warnings only).

A separate local browser replay verified a usable failure surface and the same
Recovery reference after a real page reload, with native/server/provider calls
stubbed. This establishes UI/journal behavior, not Safari hardware reliability.

No provider conversation, new invitation, report regeneration, schema mutation,
profile/rubric/turn-policy change, hiring action or Production deployment is part
of this task. Physical iPhone Safari has not been certified. The remaining test
uses the existing failed invitation while valid: Home/foreground → first Continue,
then a cold refresh → first Continue, checking actual audio, same attempt,
confirmed conversation progress and explicit recording gaps. Retain the displayed
Recovery reference if any step fails; do not infer a native cause from a missing
callback alone.
