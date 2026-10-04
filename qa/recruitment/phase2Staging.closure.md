# Recruitment Phase 2 — Staging closure

Verified 2026-10-04. QA level **L3 Canonical**. Synthetic candidates only.

## Delivered authority and environment

- Canonical code verified at `2abfc22f879b769c1cc9f80bc544ea977b7968e3`, clean `dev`/`origin/dev`, Staging READY deployment `dpl_AufcwSgMgUbWXjWLebWRSa4LJYzT`. Subsequent closure changes contain QA harness timing, assertions and documentation only.
- Staging Supabase `ujkzdaaadnvcfayuldmh`, Vercel `prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi`, alias `fnb-system-staging.vercel.app`. Production and `main` untouched.
- Applied append-only migrations `20261003185552_recruitment_phase2_interview_core.sql` and `20261003192606_recruitment_phase2_scenario_evidence_order.sql`; deployed Recruitment-owned `recruitment-realtime` and `recruitment-evidence` Edge Functions.
- Existing unrelated Payroll ledger timestamp mismatches were not repaired or replayed. Scoped migrations used the managed migration authority and local filenames match its applied timestamps.
- People/Employee/Auth/Crew and Guest AI business authorities remain separate. No Phase 3 candidate summary, hiring score, manager decision or Employee conversion.

## Verification results

| Check | Result |
|---|---|
| Focused Recruitment + hostname regression | 15 tests passed; build passed; diff whitespace check passed |
| SQL lifecycle and scope | Rollback-only local PG17 and Staging checks passed: lease concurrency, transcript immutability/order, candidate citations, ordered scenario question/answer, pending finalization, complete/partial/failed evidence, receipt retention, expiry/revocation and maximum deadline |
| Admin authority | Existing owner read/playback succeeded; existing manager lacking permission denied; existing restricted account outside outlet scope denied by canonical scope helper. No temporary grants |
| Public boundaries | Anonymous manager request 403; direct verification RPC/table 401; private media denied; revoked invitation unavailable |
| Baseline candidate | Consent → device readiness → record → real OpenAI interview → transcript/coverage → saved. Final attempt Completed; recording Complete; verified MP4 5,028,714 bytes, 640×480 |
| Conversation | Dynamic outcome follow-ups; EN, Chinese and BM responses and durable transcript. Scenario explicitly asked at displayed turn 3, answered at displayed turn 4 (stored citation IDs 24 and 28); volunteered earlier answer cannot complete it |
| Recovery candidate | Real provider reconnect while recorder stayed active; 18-second HTTP offline/upload retry; simulated visibility interruption; fresh camera capture; reload after lease expiry; same attempt and retained progress; explicit candidate partial stop |
| Recovery evidence | Partial / Partial; three server-verified MP4s: 2,171,506 / 708,542 / 805,400 bytes. Manager browser loaded all at 640×480, durations 61.2994 / 20.25075 / 22.8479 s. First unit played. Background and reload gaps visibly disclosed |
| Deadline recovery | Prior interrupted attempt reloaded after deadline and finalized Partial, retaining a playable unit; deadline forbids another AI session |
| Missing local trailer | Earlier failed upload attempt retained acknowledged raw chunks but insufficient bytes for final MP4; finalized Failed rather than fabricating a playable recording |
| Advisors | No unexpected Recruitment security exposure; expected RPC-only RLS/no-policy and controlled SECURITY DEFINER notices reviewed |

The recovery harness reached the saved screen but attempted a second click on disabled Finish after finalization and timed out. Stored evidence and authenticated manager UI confirmed successful finalization; the harness now checks enabled state before clicking. The full recovery workflow was not rerun merely for that final harness timing correction.

Live QA exposed and fixed actual defects: signed TUS uploads failed on Staging, so transport uses acknowledged immutable raw chunks and server streaming assembly; lost upload acknowledgement is reconciled before requesting another signed URL; stop/upload drains are serialized; oversized delayed recorder blobs split into bounded transport chunks; scenario answers require an earlier cited AI scenario question. Historical final QA evidence was retained.

## Evidence and practical limits

Private temporary QA artifacts under `/private/tmp/recruitment-phase2-qa` and `/private/tmp/recruitment-phase2-recovery` contain synthetic audio/browser state and invitation material. Tokens, provider secrets and signed playback URLs are intentionally absent from this report. Candidate baseline screenshot: `/private/tmp/recruitment-phase2-qa/candidate-saved.png`. Temporary files are supporting evidence, not canonical data contracts.

Desktop Chromium used a 390×844 viewport, synthetic camera and prerecorded synthetic speech. Visibility interruption was simulated; this does **not** certify physical mobile backgrounding. Physical results and outstanding full interview checks are recorded in [mobileMediaValidation.md](mobileMediaValidation.md).

Safari can still produce an invalid second independently stopped unit; verification must reject it and preserve prior evidence as Partial. Full-duration iOS/Android recording, mixed audio, battery/memory/echo, screen lock and native multilingual speech accuracy remain physical-device checks. Synthetic BM speech had pronunciation/transcription errors, so multilingual configuration and live responses do not establish native BM accuracy. Browser background continuity and final MP4 trailer survival are not guaranteed.

Server MP4 verification checks structure, tracks, dimensions and byte receipts; it does not fully decode codecs. Playback verified the synthetic QA units. Transcript is a browser relay of provider events, not independently attested provider content; approximate timing and interrupted AI speech are labeled. Managers must verify claims against recordings. Consent remains provisional Phase 1 copy and needs approved policy wording before real candidate collection.
