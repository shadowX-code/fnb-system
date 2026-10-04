# FeedX AI Interview V1 — human Staging acceptance

Status: **Prepared; human execution pending.** No voice-naturalness or full mobile-quality PASS is inferred from automated tests.

## Prepared application

- Opening: **QA Service Crew — V1 real-device acceptance 2026-10-04**, configuration v1.
- Canonical Position: Service Crew; existing QA Workplace: QA Demo — Reporting Posters; existing Legal Employer: FeedX V2 QA Employer.
- Candidate: **V1 Human Acceptance Tester**, synthetic contact `0000000055`. Keep these details; do not enter real personal identifiers.
- Application `2082f00c-cdf4-499e-a161-40a6fcf19094`; attempt `ed2cac1c-f049-4608-bb4e-acc882043dc4`.
- Target 9 minutes, maximum 10 minutes. Approximately 8–10 minutes is a conversational target, not a forced minimum. Shorter completion is acceptable if meaningful coverage is genuinely satisfied; never pad with repetitive questions.
- Required topics: previous F&B role/duties/example; availability/start date; weekday/weekend/closing-shift flexibility and constraints; customer-service example/outcome; teamwork during a busy shift.
- Scenario: a customer receives the wrong meal after waiting 15 minutes during a busy service. The AI must present the hypothetical and collect an answer afterward.
- Optional expected salary creates a missing-information follow-up opportunity; it is not a mandatory completion target.
- Invitation expires **11 October 2026, 11:18:48 MYT**. Exact private URL is provided in the task handoff and `/private/tmp/feedx-launch-invitation.txt`; bearer token is deliberately absent from Git. Opening must remain Open. Do not issue another invitation before this run; that revokes the prepared one.

## Device and preparation

Primary: **physical Android phone, Chrome 154 or newer**, in the normal browser (not WhatsApp/in-app webview). Record the actual model, OS and browser version. Secondary separate run: iPhone Chrome 154 or newer. Safari is a separate higher-risk validation run because previously valid first MP4 capture did not establish reliable later captures. All platforms still need full-duration validation.

Allow 15–20 minutes including preparation and manager checks. Charge the phone, use stable Wi-Fi/mobile data, a quiet private space and moderate speaker volume; do not use Bluetooth for the baseline. Keep the page foreground and screen awake. Camera must show a preview; speak to confirm the microphone meter. Read and personally accept the approved consent checkbox. Nothing is recorded during the device preparation check; capture starts with Start interview.

Use the **canonical Staging URL supplied in the handoff**. `interview.feedx.my` is not DNS-ready and is intentionally not part of this run. No FeedX account is required for the candidate. Start one attempt once; do not use multiple devices/tabs concurrently with this link.

## Candidate session

1. Welcome → job information → confirm the synthetic profile → **Before you begin**. Check all three approved body paragraphs and the single explicit consent sentence. No provisional-copy banner or fabricated privacy/retention promise should appear.
2. Consent → camera/microphone check → Devices ready → Start interview. Verify visible recording state and audible AI.
3. Respond naturally with invented but consistent work examples. Aim for 45–75 seconds on substantial examples; do not read a script or dump all topics into the first response. Let the interviewer choose questions and follow-ups.
4. Useful fictional facts: worked six months in a café on orders/takeaway; apologized for a missing item, checked receipt/kitchen, replaced it and confirmed resolution; coordinated with kitchen and teammates during a rush; available from 15 October 2026; generally available weekdays/weekends, but needs to confirm transport for very late closing shifts.
5. Start in English. Give at least one natural BM answer, one Chinese answer if comfortable, and one mixed answer. For example, describe customer/kitchen coordination in your own words. Do not force languages you cannot speak; mark those acceptance areas untested and arrange another tester.
6. Leave a normal 3–5 second thinking pause in one answer, then continue. Judge whether the AI waits rather than talking over you. Ask for a question to be repeated once if useful.
7. When salary is asked, say you have not settled an expected amount and would like to understand the role's budget. If asked about very late shifts, clearly distinguish confirmed flexibility from unconfirmed transport. The AI may clarify once, then should preserve uncertainty rather than invent certainty or repeatedly pressure you.
8. Answer the complaint hypothetical after it is presented: listen/apologize, verify the order, coordinate a correction/time estimate with kitchen and involve the shift lead when needed. Say what you would communicate to the customer.
9. Allow the AI to offer a final addition and close naturally after coverage permission. Wait for recording upload/finalization and the saved outcome; do not close immediately after goodbye. Baseline should seek Complete evidence, but truthful Partial/Failed status must never be concealed.

Do not deliberately background, lock, reload or disconnect during the baseline. Test interruptions separately with a fresh invitation after preserving this report; seamless continuity is not promised. If an interruption occurs naturally, note its time/reason, follow device reacquisition/recovery prompts, and check that acknowledged units survive with explicit gaps. Do not call a Partial outcome a Complete PASS.

## What to judge about voice and conversation

- Warm, natural, professional Malaysian F&B tone; subtle Malaysian English intonation, clear speech, comfortable pacing. No exaggerated accent or inserted “lah/lor/ah”. The base voice remains OpenAI `marin`; regional delivery is prompted, not a guaranteed/custom recorded voice.
- Brief AI introduction; one question at a time; listens through normal pauses; useful follow-ups; short varied acknowledgement without repetitive praise.
- Natural transitions using the answer; does not read a checklist, repeat established evidence or prolong the interview just to fill time.
- Natural EN/BM/Chinese/code-switching pronunciation, comprehension, language matching and transcript fidelity. Accent/code-switching must never be framed as a weakness or suitability signal.
- Accepts unresolved salary/transport information honestly. Presents the actual scenario. Concludes politely after coverage, without promising a job or making a hiring decision.

Capture observations as Pass / Needs tuning / Not tested for each item, with the approximate time and a brief example. Human listening and recording review are required; prompt/unit tests alone do not establish these results.

## Manager acceptance — review only, no Hire

1. On a separate authenticated Admin session, open canonical Staging People → Recruitment → Applicants / Applications → **V1 Human Acceptance Tester → Review application**.
2. Check attempt/recording/transcript health and any gaps. Play the recording and verify both candidate and AI audio plus valid camera video through the ending. Test full playback, not just initial metadata.
3. A report is enqueued after finalization. Refresh evidence; if queued/expired, use the existing Generate/Continue report action. Record whether automatic generation completed. Do not silently regenerate a reviewed report.
4. Check all five topic findings, the complaint scenario, start/shift facts, observed text languages and unresolved salary/late-transport follow-up. Compare findings with original words; no invented salary, fluency judgement, personality/suitability score or automatic rejection.
5. Click representative citations → transcript turn → recording context. Timing is approximate; unavailable correspondence must stay explicit. Check a BM/Chinese/mixed answer against playback and transcript.
6. Mark report reviewed if desired. **Do not Shortlist, Reject, Final Interview or Hire as part of this acceptance. Do not create an Employee.** Leave the application Awaiting review, retain evidence, and send the observed results to this task.

## Later candidate-domain configuration — not applied

`interview.feedx.my` currently has no resolving record and is not assigned to the Staging project. Existing FeedX hosts belong to Vercel project **fnb-system**. After Staging acceptance and separate Production authorization:

1. Add `interview.feedx.my` to the existing **fnb-system** Vercel project's Production domain list (no new project/service), serving the separately approved Production code/Supabase environment.
2. At the existing external authoritative DNS provider (`ns184/185/186.mschosting.com`), add the record reported by Vercel's domain inspection on 4 October 2026:

   | Type | Host | Value |
   |---|---|---|
   | A | `interview` | `76.76.21.21` |

   This is the full name `interview.feedx.my`. Recheck Vercel's project-specific recommendation at configuration time; if it requires a project-specific CNAME instead, use that exact returned target instead of publishing both. Do not change nameservers or other FeedX records. No DNS record was created/modified in this task.
3. Verify Vercel domain ownership/configuration, TLS certificate, DNS resolution, Production environment identity, public `/i/<token>` routing and host isolation (Admin paths denied). The existing SPA fallback/hostname gate and Recruitment CORS already recognize the host. Confirm invitations use that origin only after the host is ready.

These are requirements, not a Production deployment or completed domain setup. No real candidate data should be sent to an unverified hostname.

## Technical verification and remaining acceptance

Approved copy selection/snapshot/idempotency/stale rejection and scopes are checked in local PG17 and Staging rollback QA. Existing Phase 2 recording/coverage and Phase 3 report/Hire regression remain intact. Staging voice Edge delivery, focused browser/component tests, build and canonical SHA/alias identity are verified in the launch closure handoff. Actual regional voice quality, full mobile recording/mixed audio, multilingual accuracy and automatic full-session report completion await this human run. No Privacy Notice URL/content exists on the current public surface; none was invented.
