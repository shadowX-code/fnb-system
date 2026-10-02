# Management Task Detail and Today’s Team

Date: 2026-10-02

## Changes

Scoped Production-based cherry-pick of verified Staging `416f3dc4`. Management may inspect authorized outlet Task results/evidence without execution/reset rights. Today’s Team uses only canonical published roster and attendance for the selected authorized outlet. Personal Crew Home and the deployed Management Cash Checkout release are preserved.

## Migration Impact

Only `20261002033911_crew_management_task_detail_today_team.sql`. Guards/object-existence checks, rollback-only Production migration trial and existing-evidence authority trial passed. Isolated `--include-all` dry run and apply list only this older migration; no applied migrations replayed. Six affected definitions/grants match Staging; 88 independent Task/Cash/Roster/Attendance definitions/grants unchanged. No roster or attendance records created for QA. Temporary read-test sessions were rolled back.

## Deployment Notes

Isolated build and five focused read-view tests passed. Checks cover Management reads, cross-outlet rejection, denied execution/reset, canonical team counts and unchanged assigned-Crew detail. Recovery baseline main `9ffb0451a5ad4ead3b0492fe568055189d3b616a`, deployment `dpl_BDJYPshJuMqYLvWsEGif87QxpmDz`, local recovery tag and scoped definitions/ACL/ledger snapshot retained. Proportional browser smoke uses available authenticated sessions without business-data writes.
