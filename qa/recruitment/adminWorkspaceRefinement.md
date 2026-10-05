# Recruitment Admin workspace refinement

QA level: L2 Workflow. Six surfaces: Home, Opening Overview, Candidates, Opening Setup, Profile Library/Detail, Application Review.

Shared presentation composes canonical FeedX controls and theme tokens. No RPC, schema, report/coverage prompt, finalization, recording, realtime or hiring changes. Candidate fit previews read the latest Ready report through the existing protected manager evidence API; no model/report generation occurs during reads. At most the current 20-row candidate page can request evidence, and pre-interview rows do not request it. Unavailable/legacy report fit is explicit.

## Focused verification

- 22 focused tests pass: local combined search/status filtering; canonical scoped QA/lifecycle query; view-only profile publication gating; opening save payload; immutable next-version publication intent; existing consolidated review/citations; coverage vs fit tones; finalized list fit read; pre-interview read suppression; failed fit read fallback.
- Production build passes with existing bundle-size advisory; diff check clean.
- Authenticated canonical Staging: Home search/status empty state and restore; opening Overview requirements, plan disclosure, attention/activity; Setup section hierarchy and secondary guidance; Candidates Review and evidence/fit state; registration entry/cancel; Profile Library -> Detail -> next-version local draft -> discard without publishing; review section navigation and original Chinese transcript access. Existing QA synthetic report displays Meets / Does not meet / Unclear separately from Covered, without generating a report or making a hiring decision.
- Original physical acceptance remains terminal with unavailable recording, preserved transcript/history and queued report. No interview/hiring/business data was changed during UI verification. QA openings remain opt-in; filters are restored afterwards.
- Desktop and tablet layouts are inspected with DOM overflow checks and screenshots. Source evidence remains collapsed by default; decision navigation focuses the existing decision section. Manager decisions are not executed.

No unrelated Recruitment QA, Production deploy or main modification. Browser QA verifies presentation/navigation, not interview voice or physical-device runtime quality.

## Final presentation polish

L2 scope: canonical SelectField/listbox and ActionMenu keyboard/focus interactions; Admin control focus/pressed/checkbox presentation; all six Recruitment surfaces. No authority or runtime change. Native Recruitment selects replaced with shared selection controls; joined date retains DatePickerField. Candidates and Review explicitly distinguish application stage, interview evidence outcome, recording and report state. Failed interview evidence is labelled Evidence incomplete, never candidate failure. Setup uses one workspace surface, grouped fields and a sticky action bar. Source evidence remains collapsed and version preparation secondary. Focused shared-control and Recruitment suites plus authenticated canonical Staging desktop/tablet visual/action checks form the proportional gate; no real publication, hiring or recording changes are required.
