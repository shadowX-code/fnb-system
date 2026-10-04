# Physical acceptance — bounded recovery correction

Scope: recovery only. Production remains blocked. Do not evaluate or change voice quality in this run.

## Prepared invitation

- Candidate **V1 Bounded Recovery Acceptance Tester**, synthetic contact `0000000103`.
- Application `bc0441c8-ca38-47bc-94be-60b8217d710a`, existing **QA Service Crew — V1 real-device acceptance 2026-10-04**, pinned configuration v1.
- Exact canonical Staging `/i/<token>` invitation is in the handoff and `/private/tmp/feedx-bounded-human-invitation.txt`. Bearer token is omitted from Git. Expires **11 October 2026, 19:19:12 MYT**. Do not issue another link before testing.
- Use the **exact physical phone and browser that failed Acceptance #2**. Record OS/browser versions and audio output (speaker/wired/Bluetooth). Use one normal browser tab; retain the synthetic profile. No FeedX candidate account required. Consent must be accepted personally.

## Independent recovery checks on the same attempt

1. Begin normally; answer a question with a memorable invented fact (for example, six months in a café taking orders). Confirm visible camera and audible AI. No recording starts during preparation.
2. Switch to **Home**, wait about 15–30 seconds, return to that browser tab. Tap **Resume with camera and microphone**. Expect explicit progress, fresh camera/mic, a fresh recording unit and continuation from saved conversation in the same attempt. Old uploads may remain pending; they must not disable live continuation.
3. A genuinely unavailable native device/audio dependency must produce a visible error and enabled retry, rather than indefinite loading. If shown, tap Resume once more after closing any competing camera/mic app. Note the exact error/time. If usable continuation still fails after two retries, preserve the attempt and report the screen/error; do not repeatedly restart or clear storage.
4. After successful foreground recovery and another short answer, **refresh the whole page**. This is a separate cold-bootstrap check. Expect the saved interview / explicit Resume action. Tap it, confirm new device acquisition, camera/AI and preserved prior facts. It must not replay completed turns as a new interview or require a new invitation. Previously interrupted/unplayed questions may require a brief truthful reorientation.
5. Complete normally if convenient, or **Stop and save partial interview** after proving both recovery paths. Allow upload/save; a bounded saving error must expose Retry saving evidence. Deliberate recording gaps mean Partial, not Complete.
6. Authenticated manager: People → Recruitment → Applicants / Applications → **V1 Bounded Recovery Acceptance Tester → Review application**. Check same attempt/context, recording units before/after recovery, explicit gaps/invalid units, transcript annotations and available evidence. Play retained verified units. Partial/Unusable describes collection evidence, not candidate performance. **Do not Hire or create an Employee.**

Report foreground and refresh independently as Resumed / Working retry required / Terminal with explanation / Failed, with approximate timestamps and visible errors. Note whether the preview and AI actually worked after Resume. No continuous background capture or physical PASS is inferred from automated fault injection. Preserve this invitation/attempt if anything fails so new stage/client/media diagnostics can identify the exact dependency.
