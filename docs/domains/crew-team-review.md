# Crew Team Review

## Ownership

Team Review is an independent monthly coworker-evidence domain under the Performance workspace. Workforce owns roster and attendance facts. Team Review owns eligibility, the review window, submissions, exclusions, Admin fallback and its `/5` result. Performance consumes only the Ready result; Reward consumes only finalized Performance. Neither Payroll nor Reward eligibility affects teammate eligibility.

## Eligibility And Window

An active Job Position explicitly opts into Team Review. Both employees must be active, hold participating positions, belong to the same outlet/month, and have at least one overlapping working period in the latest published Duty Roster. Completed Attendance that contradicts a scheduled overlap or an approved-leave roster projection disqualifies that overlap; missing or incomplete clock evidence does not. There is no shared-hours threshold, selected reviewer assignment or quota. Every eligible pair can review each other once. Eligibility is live while the window is open and is frozen into outlet/month subject and pair snapshots, including attendance-overlap count and roster corroboration, on close.

The default Malaysia-local window opens at the start of the last three calendar days of the month and closes at the start of the third calendar day of the next month. A trusted scheduler freezes due months; submit is denied at the exact close boundary even if the freeze job has not yet run. Authorized outlet-scoped reviewers may open early, close early or extend a still-open deadline with a required reason. Each exception appends actor, time, before/after window and reason evidence. No exception reopens a closed/frozen month.

## Crew And Admin Evidence

Crew Home shows a one-time introduction for an open period with teammates available, then a compact action card. Crew sees all currently eligible teammates with Review/Reviewed state. Teamwork, Reliability, Communication and Work Attitude each require a whole-number rating from 1 (Rarely) to 5 (Consistently). An optional comment is Admin-only evidence and does not affect the score. The token-bound server rejects self, duplicate, ineligible, closed-window and finalized-result submissions. Submission refreshes the Crew list without creating Daily Tasks.

The Team Review result is the direct average of the four dimension averages, rounded to two decimals on a five-point scale. Valid, non-excluded Crew reviews are provisional during the window. After close and eligibility freeze, at least one valid review makes the result Ready; zero makes it Admin Review Required. An authorized Admin may then record the same four ratings as a one-time fallback, with source `Admin Review`. Excluding a Crew review requires a reason, preserves the original evidence, and recalculates the aggregate; if no valid review remains, Admin fallback becomes required. Finalized Performance cannot have its Team Review evidence changed.

Crew My Performance receives only aggregate score, dimension averages and source-safe status, never individual reviewers, ratings or comments. Identified submissions, Admin fallback ratings, work-overlap evidence, internal comments, exclusion reasons and window exception history are available only through an outlet-scoped Admin reviewer authority. Direct table access is revoked with RLS enabled.

## Compatibility

Historical Peer Review migrations and tables remain intact in canonical migration lineage, but their old public mutation/read RPC grants are retired. Current UI says Team Review. Performance retains the internal `peer` JSON component and `peer_score` column for the existing V2 result contract; these do not own eligibility or review operations. Google Customer stays pending and Reward stays finalized-Performance-only.
