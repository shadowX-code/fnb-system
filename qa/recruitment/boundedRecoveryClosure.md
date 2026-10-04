# Human Acceptance #2 — recovery correction

Production remains blocked. Voice changes are paused. No original evidence was rewritten.

## Exact failed Staging evidence

Application `3bd13ac3-1782-401a-9888-73710723bf1f`, attempt `d99cfb86-ded4-44e9-a83f-511e31ab9bfc`, from the invitation delivered with canonical `5448a992`.

| UTC (4 October 2026; add 8h for MYT) | Durable observation |
|---|---|
| 07:36:35 / 07:36:43 | Same attempt starts; recording unit 1 and provider generation 1 connect. |
| 07:39:48 | `media_track_muted` gap, transport closes; unit 1 becomes Invalid. |
| 07:39:55 | Server resume succeeds, records `interview_resumed` and `resume_requires_new_capture`. No fresh unit or generation follows this resume. |
| 07:40:11 | Another `page_backgrounded` interruption. |
| 07:53:03–10 | A later resume succeeds after lease expiry; unit 2 / generation 2 connect. This later successful interval is retained; it does not contradict the reported earlier foreground/refresh failures. |
| 07:57:28 | Another `media_track_muted` interruption/transport close; unit 2 Invalid. |
| 07:57:34 | Server resume again succeeds without a new unit/generation. |
| 07:57:49 | Background interruption; attempt remains Interrupted, with approximately 111 seconds active budget left. |

Server observations rule out invitation denial, exhausted duration, a blocked device lease and failed server begin for the captured resumes. A valid lease identity was submitted; the old browser did not record a cold-bootstrap client tag. Durable configuration/turns/coverage remain retained. Response/playback diagnostics stop with each transport closure; they do not show a competing replacement response or provider session during failed recovery. The two Invalid units are never reclassified as verified/complete.

**Confirmed failure boundary:** after successful server begin, before recording-unit open/provider credential acquisition. The client awaits old capture stop, interruption acknowledgement, IndexedDB reconciliation, old transcript flush, device enumeration/acquisition and Web Audio resume without a complete finite/cancellable stage authority. Web Audio activation happens after asynchronous server/storage work. `starting`/busy can remain latched indefinitely, making additional taps ineffective; cold refresh re-enters those same dependencies. `AudioContext.close()` was included in captureStopped, even after camera tracks stopped.

**Evidence limit:** `5448a992` diagnostics did not record Resume commands, bootstrap, individual recovery awaits/native audio states or their rejections. Therefore the exact native promise responsible for each historical stall cannot be identified retrospectively. Web Audio resume/activation is a concrete defect/risk in that path, not a claimed uniquely proven acoustic/platform cause. Stage fault injections establish the owning pipeline failure mode; they are not physical-device evidence.

## Correction and states

- A finite operation owns `RECOVERING`; every mandatory stage has timeout/cancellation and late-result fencing. It converges to `RESUMED`, `RECOVERY_REQUIRED` with enabled retry, or `TERMINAL` with explanation/save path. Background/unmount cancels in-flight setup rather than retaining `starting`/connecting latches.
- Resume activates a fresh audio context and starts fresh camera/mic acquisition directly from the tap. Device enumeration/meter context are omitted from live reacquisition. Native audio resume timeout reports an actionable error. Old tracks/context close, transcript persistence and uploads cannot hold continuation hostage; recent local transcript flush is bounded/best-effort and server-durable context remains authoritative.
- Cold bootstrap reads durable public entry, exposes bounded load retry, then reads server recovery state and creates new media/provider ownership. It does not join old JS transport/capture promises.
- Server recovery request/result and expected-current recovery ID make retry idempotent and reject stale operations. Old pause, recording-open, context and connected acknowledgements cannot alter a newer recovery. Setup lease is 90 seconds; normal existing lease rules still own active sessions. Pauses preserve the active budget and append explicit gaps.
- Old unit reconciliation/upload runs independently and explicitly excludes the currently live unit, preventing delayed reconciliation from abandoning new capture. Recorder trailer/integrity uncertainty remains truthful. Interrupted/invalid evidence is not converted into complete evidence.
- Recovery operational observations are bounded and token-validated before media/provider exists: command, visibility, bootstrap, stage/state/error code, opaque client comparison tag, media track kind/state/muted and audio state. No tokens, raw client IDs, device labels, prompts, transcripts or audio enter these diagnostics. Direct table access remains denied.

## Targeted verification

- Local component/native-recording regressions: pending native audio resume, pending context close, stale capture/upload, repeated taps, mid-recovery visibility cancellation, cold remount, terminal link state, bounded transcript retry and exclusion of fresh unit from old reconciliation.
- Local PG17 and Staging rollback: idempotent request/result/deadline, prolonged paused budget, same transcript/config/coverage, stale begin/pause/open/provider ownership rejection, one capturing unit and bounded diagnostic grants/payloads.
- Exact failed attempt, Staging rollback only: cold recovery returns Starting with >100 seconds and the same pinned configuration/transcript; identical request retry succeeds. All mutations rolled back, preserving original evidence.
- Canonical real-provider browser fault-injection/manager verification is recorded after delivery. Physical-device success cannot be claimed from these tests.

## Canonical Staging completion

- Final runtime build: canonical `5f2f676a86306e495c110709a87aaafbbe28730e`, READY deployment `dpl_By9JPUw8D2CAjtji1GrSvsUm4jL2` in verified `fnb-system-staging`. Recovery migration ledger `20261004105006`; realtime function deployed only to `ujkzdaaadnvcfayuldmh`. Subsequent documentation-only delivery does not change this runtime contract.
- **32 focused tests / 5 files pass**, build/diff checks pass. Added late heartbeat/deadline/recorder callback ownership regression and muted-track timeout/reacquisition. Finalization and finalization retry dependencies are also bounded. No unrelated Recruitment decision/Hire or Phase 1–3 QA was rerun.
- Canonical real-provider fault run: application `27b03cbb-1707-4421-9d68-822842b4d500`, final attempt `29879ba6-96c6-4a68-8ff7-954d27beb325`. Foreground and cold-refresh paths were exercised independently, each with a deliberately never-settling native audio-resume promise. Both produced the visible ten-second timeout / enabled retry and then RESUMED. Stale native close and upload promises remained pending during continuation. One tab comparison identity, two durable timeout events, three RESUMED transitions and three connected provider generations are retained. These are fault injections, not observations of the physical OS.
- Recording 1 and 3 are verified 640×480 MP4; reload unit 2 is Invalid and retained truthfully. Final outcome Partial. The earlier identical canonical run `71005d44-1267-440e-8e96-9873c0b22294` was reviewed in the authenticated manager UI: two playable units, disclosed gaps, retained invalid unit, neutral Unusable report because no candidate answers were given. Recovered unit played through its end. No report findings/candidate speech were invented for this synthetic recovery-only run.
- Private request logs/screenshots are in `/private/tmp/feedx-bounded-final` and `/private/tmp/feedx-bounded-canonical`. No tokens or signed media URLs are committed. The disposable local validation container was removed; unrelated containers/worktrees were preserved. Original physical attempt remains Interrupted / generation 2 / original pause/config, with no persistent recovery mutation.
- The historical diagnostics cannot identify the unique native promise that stalled the physical run. The corrected owning state machine eliminates indefinite pending gates regardless of which dependency stalls; actual physical recovery success still requires acceptance. Production remains blocked, voice configuration unchanged. Fresh invitation instructions: `v1BoundedRecoveryAcceptance.md`.
