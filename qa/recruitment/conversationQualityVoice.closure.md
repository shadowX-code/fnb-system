# Conversation quality and Staging Voice Lab — focused closure

## Primary physical evidence and pinning

Attempt `88af34fa-7af7-4e52-9d5f-a5313d5b3063` is the requested 28-turn physical case. Its immutable configuration `b912a40c-0715-4384-be3e-cb30c0a51772` references Service Crew **v1**, profile `fc7f795f-66d5-45e1-8441-2913d0de64b2`. The report source snapshot references that same profile. Report instance version 1 and prompt `recruitment-report-v3` are separate authorities, not Interview Profile versions. Admin evidence reads join the attempt's config; no data/display repair was needed. The physical transcript shows repeated Teamwork clarification/coaching and missed Cantonese/English changes. Historical evidence was not changed.

## Scope

Session guidance opens with confirmed role/workplace/scope, approximate duration and self-introduction. Important Partial is omitted from minimum-evidence collection priorities when the pinned criteria allow it; legacy minima remain unchanged. Introduction/cross-area evidence is reused, vague probing is normally bounded to one useful clarification, and coaching/repeated Teamwork reformulations are discouraged. Meaningful current language and explicit requests govern speech; borrowed words are not independent switches. Once candidate speech exists, greeting preference retires to ambiguity fallback. English presentation is conditional on speaking English, separate from plan/coverage authority. Empty job-fact fields are explicitly unconfirmed and excluded from the confirmed-facts projection; a rotating-shift fact does not establish holiday policy.

Transport/VAD/response adapter, recording/finalization, published profiles, reports, fit, hiring and People conversion were not changed. Canonical voice remains **marin**, human selection pending.

## Focused checks

- 11 focused tests: planner minima/legacy fallback, intro/evidence reuse guidance, language/recovery context, empty-fact projection, V2 continuation/scenario policies, six-voice/four-language allowlist, WAV header, local replay, cancellation fencing and visible retry. No unrelated Recruitment suite.
- Local initial production build passed; final integration build verification is recorded in deployment metadata.
- Voice Lab: authorized Admin Play/Replay, real `gpt-realtime-1.5` output, six supported voices (marin, cedar, ash, coral, sage, verse), fixed EN/BM/Mandarin/Cantonese opening samples. Anonymous access returned 401. Staging project and origin guards reject other environments/origins; canonical active-Admin `recruitment.manage` controls access. No applicant/People data is read or sent, and no credential is returned to the UI.
- A real Staging SDK response-format defect was fixed: binary WAV travels as octet-stream, then the client creates an audio/wav Blob. Samples cache only in page memory. Native playback and generation have bounded retries.

## Real-provider evidence and limits

Disposable audio-only fixtures `785548d5-2f0c-4078-9ab4-596f275de6fa` and `0dea598e-59d9-4d54-894b-3df48d344b8b` exercised the physical probe pattern and language carry-over; the latter also used fresh generation reconstruction with durable context. Provider-owned automatic responses/VAD were unchanged. The opening included workplace, role scope, duration and introduction. Introduction evidence supported experience, complaint evidence supported multiple areas, Teamwork remained Partial with canonical completion allowed, the 10:30 PM ambiguity received clarification, candidate Q&A occurred, and provider closing obtained server permission. Synthetic fixtures honestly finalized Failed for missing camera evidence; they do **not** certify a newly recorded Complete interview.

Observed successful automatic transitions included Mandarin → BM, BM → English and English → Cantonese, plus immediate explicit Cantonese and final BM closing. Earlier outputs also missed Cantonese/Mandarin changes and carried a Chinese phrase into BM. Those failures prompted the scoped preference/presentation fixes; **consistent multilingual behavior is not certified as PASS**. One public-holiday unknown answer added an unsupported typical-shift assumption. Final guidance explicitly separates empty/unconfirmed facts and rejects that inference; deterministic model adherence remains unproven. These quality findings must remain visible in human acceptance, not concealed by contract-test passes.

Voice generation/playability proves provider availability, not Malaysian accent, Cantonese pronunciation or human conversation naturalness. No automated voice ranking or selection was made. Use the protected Voice Lab for listening without running multiple physical interviews. The one fresh human invitation is for normal foreground conversation and recorded completion, with the published Service Crew v2 pin. Production is not approved by this pass.
