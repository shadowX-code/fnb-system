# Interrupted orientation / offering routing closure

Scope: L2 Recruitment conversation workflow. No schema, Profile, coverage/fit, recording, recovery, report or hiring authority changes. Documentation Impact: Updated `docs/domains/recruitment.md`.

## Primary physical evidence

Attempt `70456ad7-42ae-4429-a2a1-f7cf15144a60`, 37 turns, pinned published Service Crew v2, initial Mandarin. Both first responses were cancelled/truncated (first item at 620 ms; second at 640 ms). Short Hello / Hi there led to English and experience probing without job orientation. Turn 16 supplied FT 07:30–17:00 before Turn 17 explicitly chose PT. The existing Application preference observer correctly changed Unknown to PT at 17:06:37 UTC, citing turn 608. No Profile mismatch or preference-authority defect. Closing exposed completion-system narration.

## Owning changes

- Persistent pending orientation replaces first-response-only orientation. Provider silently calls `confirm_orientation` in the same completed opening response. The adapter requires that response's noncancelled done + drained-output receipt, fences newer turns, then acknowledges the tool without `response.create`. It waits for the candidate introduction; normal VAD remains provider-owned.
- Matching bounded presentation traces + nontruncated durable turns preserve orientation on quiet/replacement contexts. Meaningful subsequent speech leaves the introduction phase. Late pre-orientation transcripts cannot advance it. This is browser-relayed presentation observation, not coverage authority or proof of what was heard.
- Short greetings do not establish another language. An ordered language rule removes the prior conflict where all live English input superseded the initial preference.
- Unknown in a multiple-offering opening receives offering types/shared facts, not detailed FT/PT terms. Preference comes immediately after self-introduction before availability probing. Canonical FT/PT contexts project only the corresponding pinned offering; Both preserves separate terms. Existing preference observer/authority is unchanged; persistence never gates speech.
- Concise contextual transitions, limited acknowledgements, direct confirmed-fact answers, no spoken tool/system narration. Completion remains server-authorized.
- `orientation_version: receipt-v1` is negotiated so older clients never receive the new tool.

## Focused verification

Physical 37-turn fixture preserved without applicant identity/contact. Focused adapter/context/prompt/preference tests cover interrupted/stale entry, checkpoint idempotency, ordinary response ownership, late callbacks, language fallback, offering projection and completion. Production build and diff whitespace check passed.

Real Staging OpenAI gpt-realtime-1.5 / semantic VAD low / automatic response + interruption: synthetic Mandarin interview, initial opening actually cancelled by real audio Hello. Corrected response remained Mandarin, supplied Happiness Kopitiam / Service Crew scope, approximately ten minutes and self-introduction. No second explicit entry response. Introduction supplied service/customer/team evidence; provider then asked FT/PT/Both before availability. Candidate chose PT and supplied start date/availability; coverage reused introduction evidence, optional complaint scenario used equivalent real evidence. Quiet context switched to PT-only terms without FT 07:30 schedule. Grounded RM8/hour, 8-hour/1-hour-unpaid-break RM56 answer; overtime explicitly unconfirmed. Candidate Q&A preceded a short natural server-permitted close without system narration. No recovery errors.

Harness uses real provider audio/STT/VAD over WebSocket, with synthetic WebRTC drain receipts for adapter observation. It does not certify browser playback, iPhone quality or physical receipt timing. The disposable recording unit is explicitly invalid/no camera and finalized Failed; no invented recording success. Human foreground acceptance remains required. Earlier failed provider iterations preserved privately; physical evidence untouched. Other QA suites were not rerun.
