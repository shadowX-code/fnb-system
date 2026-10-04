# iOS native recovery correction

## Primary physical evidence

Latest failed acceptance application `bc0441c8-ca38-47bc-94be-60b8217d710a`, attempt `78a2d9bb-d6a5-4acc-a878-cbbb39c555d9`; canonical `f7018101`.

UTC 4 October 2026 (add eight hours for MYT): initial RESUMED 12:04:27. At 12:06:51 media interruption and background entered RECOVERY_REQUIRED. Foreground observed 12:06:55. Resume 12:07:45 reached server approval, transcript partition and recent-transcript stages successfully, then waited at camera/microphone acquisition from 12:07:46 until 12:08:00. No new capture/provider generation followed. Server returned to Interrupted. Native `getUserMedia` did not return within its 15-second bound; the device hook swallowed that exception and returned undefined, replacing the precise timeout with generic `dependency_failed` and misleading “Allow access”. There is no permission-denial evidence. Exact WebKit internal reason for the native promise not settling is not observable in these logs. No separately identified cold-bootstrap Resume was persisted; refresh failure is the human observation, addressed by the same reconstruction path.

Original evidence remains untouched: one verified recording, 19 durable turns, pinned config `44f01578-cee5-4f30-b101-92e4137943bd`, five topic records, generation 1. Paused remaining budget persists server-side. No hiring/employee transition.

## Owning correction

- Native getUserMedia is the first hardware request from the Resume gesture, before AudioContext resume, old capture/transport cleanup and recovery server work. Minimal video-facing/audio constraints avoid forcing optional audio processing/profile negotiation during WebKit recovery. Fresh audio activation still occurs synchronously in that same tap.
- Acquire/validate fresh live unmuted tracks before claiming server resume. No reuse of prior tracks; late acquisition results are stopped. Camera timeout cannot advance the attempt or manufacture a resumed gap/provider generation.
- Propagate original native errors and timeout codes; denied permissions, unavailable device, timeout, unsupported browser and stale/muted tracks are distinct. No permission instructions on timeout/hardware failure.
- Repeated Resume stays available and replaces a pending client operation. Old abort/late callbacks cannot stop fresh tracks or mutate the new machine; existing server request cache/CAS prevents competing provider/recording authority.
- Existing independent uploads, bounded stages, transcript/coverage context, pause budgets and truthful gap/invalid unit handling remain unchanged. Cold refresh uses the same native-first gesture path with durable context.
- Bounded observations now include native request/resolution/error, optional permission state (unknown when unavailable), track validation, audio activation/result, recording and provider stages with operation IDs. No token, device label or interview content enters diagnostics.

## Verification

Focused consumer/native tests and canonical real-provider fault checks are recorded in the handoff. Technical fault injections do not certify physical WebKit recovery. Production remains blocked pending physical acceptance; voice unchanged.

### Canonical verification completion

- 40 focused tests / six files passed, production build and diff check passed. Native DOMException rejection is preserved without mutating its read-only message. Shared pending tab identity prevents replacement Resume from competing with its own browser lock.
- Existing Staging rollback contracts passed: idempotent recovery, stale recording/provider ownership, active budget, durable transcript/coverage and gap integrity. No schema/function/voice changes were required.
- Canonical Git-integrated runtime `45a52a72c3a89d5b22c0f381e934430fd074bdd8` READY, then current `3a71efab025c1bee146397409eebfe74ad72df84` READY (unrelated Payroll commit preserved). Recruitment source unchanged between those runtime SHAs.
- Isolated real-provider fault run `739c50e0-0572-4eec-88c9-126950639d07`: foreground native getUserMedia hang, NotReadableError retry, independent cold-refresh hang/retry, pending stale native close and private uploads all exercised. Same attempt, one tab comparison identity, three RESUMED transitions / three connected provider generations. Native error codes now persist as recovery_timeout / NotReadableError. Both recovery paths connected. Final Partial: four gaps, units 1 and 3 verified 640×480, reload unit 2 retained Invalid. No candidate answers invented for this synthetic run.
- Private request/status log and screenshots: `/private/tmp/feedx-ios-native`. Original physical attempt/evidence remains retained. This is technical fault verification, not physical iOS success. One fresh human invitation was prepared only after these checks, for **V1 iPhone Native Recovery Acceptance Tester** (`0000000105`), same Service Crew opening/config. No Hire/Employee action.
