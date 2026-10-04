# FeedX AI Interview V1 — Staging launch preparation closure

Verified 4 October 2026; **L3 Canonical**. Human E2E acceptance is prepared, not passed.

## Delivery

Application verified on canonical `dev` / `origin/dev` / READY Staging SHA `f9c7b831a4dd46537e8e93ee86c07d2019e0625b`, deployment `dpl_85MVSpaYADGXTEDVH2J5jwmkvLgw`, project `prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi`, alias `fnb-system-staging.vercel.app`. The subsequent QA closure commit contains documentation only; final handoff verifies its canonical READY identity.

Staging Supabase `ujkzdaaadnvcfayuldmh` verified ACTIVE_HEALTHY and workspace link checked. Applied append-only migration `20261004031834_recruitment_v1_launch_consent.sql`; deployed final Recruitment realtime function/profile. No historical ledger repair/replay, Production/main changes, DNS writes or new infrastructure.

## Verified technical results

- Approved product copy stored as immutable `feedx-interview-v1-approved`, exactly matching supplied title, three paragraphs and consent sentence. Six historical provisional consents retain their original snapshots/version. Public helper/table grants remain denied; token RPC grants remain scoped to their established roles.
- Local PG17 and Staging rollback checks pass approved selection, incomplete/stale consent denial, identical retry, snapshot immutability, accepted-version pinning after later copy, revocation, private helper boundary and Admin read-signature compatibility.
- Existing Phase 2 lifecycle and Phase 3 report/decision/Hire contract regressions pass locally and on Staging; existing unauthorized-actor report/decision scope checks pass. No Employee or Hire was created/executed by the human acceptance preparation; canonical Hire regressions were rollback-only.
- 26 focused tests pass across consent UI/profile prompt, Recruitment capture/recovery/report and hostname routing. Three Launch tests also reran after final prompt edit. Integrated build passes with the existing large-bundle warning; diff whitespace check passes.
- Authenticated canonical Staging Admin displays approved consent configured / real-device acceptance pending and saved Service Crew configuration. Public welcome/job/profile → consent verified on separate **V1 Consent Surface QA** fixture: correct copy, one unchecked checkbox, disabled Continue until explicit agreement, no provisional banner. Consent was not accepted in this browser QA. Screenshot `/private/tmp/feedx-launch-approved-consent.png`.
- Staging realtime endpoint loads with required service/provider environment configuration and rejects a syntactically valid but unavailable token with HTTP 403. This is an access/runtime check, not a successful voice-quality or mobile interview test. Existing realtime model, `marin`, low-eagerness semantic VAD and server coverage/completion authorities are retained.
- Voice presentation `feedx-malaysian-interviewer-v1` lives in Recruitment's `voice.ts`; warm F&B tone, light Malaysian intonation, calm pacing, varied acknowledgement, useful-only follow-up and neutral code-switching are instructions to be judged by a human. No new voice vendor, custom voice, Guest AI coupling, scoring or coverage redesign.

## Human run readiness

[Exact acceptance guide](v1HumanAcceptance.md) contains configuration, fictional answer prompts, device setup, voice/conversation judgement, evidence/report/playback checks and no-Hire instructions. The private invitation URL is in the task handoff and `/private/tmp/feedx-launch-invitation.txt`; no bearer token is committed.

Application `2082f00c-cdf4-499e-a161-40a6fcf19094`, attempt `ed2cac1c-f049-4608-bb4e-acc882043dc4`, candidate **V1 Human Acceptance Tester**, Service Crew config v1: five required topics, complaint hypothetical, optional unresolved salary opportunity, target 9 / maximum 10 minutes. Valid until 11 October 2026 11:18:48 MYT. Final read confirms Invited / Awaiting review, no accepted consent, no recording/report, no Employee link and unrevoked invitation. It is ready for the human tester to begin once the final handoff is delivered.

Primary recommended run: physical Android Chrome 154+, foreground/unlocked, no Bluetooth for baseline. Separate iPhone Chrome/Safari runs still required for platform acceptance. Regional voice naturalness, real-device full-duration/mixed audio/playback, native EN/BM/Chinese/code-switching accuracy, and finalized-session automatic report generation remain **Pending human run**. Any actual gaps or invalid units must remain Partial/Failed, never claimed Complete.

## Domain and privacy boundaries

At user direction, use canonical Staging `/i/<token>` and skip DNS now. `interview.feedx.my` does not currently resolve; Staging has only its Vercel alias. Read-only Vercel inspection identifies the external DNS nameservers and recommends `A interview.feedx.my → 76.76.21.21`. After acceptance and separate Production authorization, add the host to existing **fnb-system** Production project and publish the exact project-verified record; the guide records TLS/hostname/environment checks. No record/domain assignment was changed.

The current public surface has no existing Privacy Notice destination/link. None was fabricated; no retention/deletion/legal terms were added. Approved consent resolves the previous copy blocker, but does not itself certify human/mobile E2E acceptance or authorize Production.

## Subsequent human failure

The prepared attempt failed real mobile acceptance on 4 October 2026: repeated/disconnected speech, refresh recovery, background continuation and insufficient Malaysian voice. The preparation checks above are historical and do not certify launch readiness. Recovery investigation and reacceptance supersede this handoff; Production remains blocked.
