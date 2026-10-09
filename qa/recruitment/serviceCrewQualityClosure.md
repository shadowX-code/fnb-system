# Service Crew V3 physical-evidence quality corrections

## Scope

Original attempt `36d01b4c-8ba9-40d4-80a0-8d92199fa06c`, 28 turns, immutable Service Crew V3, Ready report v8. The original recording/transcript/report is not regenerated or rewritten.

Conversation guidance separates server completion eligibility from voluntary closing readiness, considers remaining time/evidence specificity/candidate willingness, favors one useful concrete episode or changed-condition exploration, and clarifies an outstanding ambiguous Q&A once. No new completion gate, minimum duration or requirement that every area be scored.

Future rubric report evaluation considers supporting/counterevidence, distinguishes evaluator observations from candidate statements and preserves all cited evidence. A narrow v4-only absence-observation classifier prevents explicit evaluator absence being presented as candidate-stated. It does not semantically score candidates; structural validation and human review remain necessary.

## Unpublished draft

Saved through authenticated existing Prepare/Save Draft workflow: Service Crew V4, draft `5280d41a-bee3-437b-9be4-2f2bb11b16e9`, revision 2, base immutable V3 `271b2d65-aa61-469f-a0ac-b2b89ec30f4d`. Communication and Teamwork basic levels no longer require an observed failure/conflict. The same structural issue is removed from Customer Service, Responsibility and Adaptability basic levels. Level 1 still requires affirmative behavior; levels 3/4 distinguish coordinated/actionable next steps and follow-through. Collection guidance, priorities, scenario policy and completion minima are unchanged. No publication, invitation, opening repin or report generation.

## Focused verification

33 tests across `serviceCrewQuality`, `rubricAssessment`, `adaptiveInterviewPlan` and `recruitmentConversationQuality` pass. The original 28-turn/pinned V3 fixture is the primary regression input; V4 is a saved-draft test fixture, not runtime authority. Tests cover instruction contracts, citation ownership/retention including positive T13 alongside T11/T15, unscored insufficiency, evaluator-absence classification, historical contract compatibility, rubric boundaries and no rubric leakage into conversation instructions. Hand-authored report validation inputs are local only; no synthetic assessment result is persisted.

Production build and diff checks pass. Existing Staging profile validator accepts the saved draft; refresh shows separate Saved Draft V4 and Published V3. L3 bounded canonical verification checks draft authority and immutable evidence read-back; no schema, permissions, realtime transport or completion authority changes.

These checks do not prove model conversational quality or guarantee semantic assessment correctness. No broad realtime/provider QA or physical interview is run in this task. Human conversation quality remains an acceptance limitation.
