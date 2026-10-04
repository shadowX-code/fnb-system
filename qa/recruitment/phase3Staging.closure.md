# Recruitment Phase 3 — Staging closure

Verified 2026-10-04. QA level **L3 Canonical**. Synthetic candidates only.

## Delivered environment and authority

- Recruitment implementation commits `40b6cae5`, `27829c87`, `fa409a76` are on canonical `dev`. Integrated application QA used clean canonical `dev` / `origin/dev` / READY alias SHA `66ac4e63c7cf7653cb15a7ee80b0ee255abc714b`, deployment `dpl_8bCfhfX6PLgr82eKvwhHhgHACP3v`. The subsequent closure commit adds QA evidence/assertions only; final delivery rechecks its READY SHA.
- Staging Supabase `ujkzdaaadnvcfayuldmh`, Vercel `prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi`, alias `fnb-system-staging.vercel.app`. Production and `main` untouched.
- Applied append-only migrations `20261004022302_recruitment_phase3_intelligence_hiring.sql`, `20261004023118_recruitment_phase3_report_readability.sql`, `20261004023942_recruitment_phase3_review_projection.sql`. Local filenames match the managed Staging ledger. No historical migrations replayed or unrelated ledger entries repaired.
- Deployed `recruitment-report` and updated `recruitment-evidence`. Phase 2 recording/realtime lifecycle and Guest AI business authorities remain unchanged.

## Verification

| Check | Result |
|---|---|
| Focused regressions | 46 tests across Recruitment report/capture/recovery, hostname routing, People lifecycle and Employee service contracts passed; integrated build passed; diff whitespace check passed. Existing bundle-size warning remains. |
| Local SQL | Disposable PG17 schema/migrations and Phase 2/3 rollback lifecycle checks passed. Preserved the Phase 2 one-argument evidence RPC signature and historical two-argument read. |
| Staging SQL | Phase 2 lifecycle/scope and Phase 3 lifecycle/scope rollback checks passed. Atomic finalization enqueue pins finalized evidence; automatic preparation reuses it; explicit version increments; reviewed results immutable; expired generation takeover denies the stale worker. |
| Access boundaries | Four new tables have RLS and no anonymous/authenticated direct grants. Existing manager lacking Recruitment permission cannot prepare/review reports or decide. Restricted existing actor cannot read evidence. Foreign report references denied; report publication service-only; anonymous decisions denied. No temporary grants. |
| Complete interview | Existing Synthetic Phase2 Candidate: actual OpenAI report Ready. Explicit v2 is concise with experience, evidenced EN/Chinese/BM text languages, configured topic/scenario findings and availability/salary follow-up. Reviewed v1 remains selectable; v2 did not overwrite it. |
| Evidence navigation | Source Turn 2 highlighted/scrolled in the same review. Recording context link sought the verified MP4 to 32.94 seconds; browser metadata 640×480, duration 137.35355 seconds. Timing remains approximate. |
| Partial/unusable | Synthetic Phase2 Recovery latest attempt: Partial recording, two gaps, three verified units retained, interrupted transcript disclosed. No candidate turns → Unusable report explicitly asks for recording review/human interview. No automatic decision occurred. Earlier partial attempt remains selectable. |
| Failed recording | Synthetic Phase2 Candidate earliest failed attempt: Ready report from retained candidate transcript, same-attempt citations, explicit unavailable recording correspondence, one disclosed gap and three AI speech interruptions. It does not invent playable evidence or treat collection failure as candidate performance. |
| Manager decisions | Authenticated UI Shortlist → Final Interview saved with report version/review; explicit Reject saved with synthetic QA reason and zero active invitations. Rejected/Hired list states display; terminal invitation actions hidden. SQL rejects invalid/reopened transitions, active interviews and conflicting retries. |
| Hire master validation | Hire from the old Phase 2 opening correctly failed because its Workplace is inactive. No master toggle/bypass or Employee was created for that failed request. |
| Canonical Hire | Fresh UI-created synthetic opening references active canonical Test Position / Management Workplace / existing Legal Employer. Synthetic Phase3 Hire QA Shortlist → Hire created Employee `caf02095-d692-41ba-9f9a-3761a3c886d4`, exactly one conversion and initial employment-assignment baseline; no Auth link, role, login or Crew access. Identical retries return the existing Employee; changed retries and second application conversion denied in rollback QA. |
| People handoff | Continue Employee setup opened the existing scoped People profile with correct person/contact/nationality/Joined Date/employer/position/workplace, existing employment timeline/change and document/access controls. No parallel onboarding forms or Employee authority. |
| Advisors | No unexpected Recruitment exposure; intentional RPC-only RLS/no-policy informational findings reviewed. |

## Report provenance

Completed attempt reports v1 `12daf7fb-e48a-4e70-af90-9ed5b03baf9a` and v2 `6cd2d770-719f-4827-899a-a6e722182959` retain identical source hash `513a72ac1a436846ac2f375c15b65c4226aea10272fe78d12c784645cdceedb3`, distinct prompt versions and actual provider model `gpt-4.1-mini-2025-04-14`. Partial Unusable report `b215973b-0c01-401d-9268-96ca97bd9bf3` made no provider assessment. Failed-recording report `f4c23309-11a6-4dde-a0b1-b5c7e4ad5e62` uses prompt v2 and the same actual provider model.

Live QA exposed excessive snapshot quotation/missing language overview and a stale manager-state list projection. Forward changes improved new reports and the canonical list while retaining existing reviewed versions. Report generation/recovery was exercised through authenticated UI; finalization-to-report enqueue was verified transactionally. A new full public recorded interview was not repeated solely to test the background worker dispatch; Phase 2 capture evidence remains its existing verified baseline.

Synthetic Hire/rejection fixtures are retained as audit evidence. No real employment decision was made. Screenshot `/private/tmp/feedx-recruitment-phase3-hire.png` shows the saved Hire and People continuation; temporary QA media/tokens/signed URLs and provider credentials are absent from this report.

## Launch blocker and practical limits

**Not ready for real candidate collection:** only provisional consent exists. Admin and public UI explicitly say Synthetic QA only until approved interview/recording copy is configured. No legal wording or approval was invented.

Phase 2 [physical mobile limits](mobileMediaValidation.md) remain: Safari may reject a later independently stopped unit; acknowledged evidence is retained as Partial. Full-duration physical iOS/Android, mixed audio, screen lock/backgrounding and native multilingual accuracy remain checks. Browser continuity and final MP4 trailer survival are not guaranteed.

Reports retain inputs, prompt/model provenance and immutable results; provider regeneration is nondeterministic. Citation validation establishes source membership, not semantic truth. Browser-relayed transcript is not independent provider attestation; AI questions may contain unheard words after interruption. Recording timing is approximate and unavailable units remain explicit. Managers must verify interpretations against original evidence. No ranking, suitability/personality score, appearance/voice analysis or automated hiring action.

Current canonical Hire creates active employment with Joined Date on/before today. Future starters remain Applicants until employment begins; this adapter does not create a new future-employment authority.
