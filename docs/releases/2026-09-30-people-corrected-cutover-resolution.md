# People Corrected Cutover Effective Resolution

Date: 2026-09-30

## Changes

People's as-of resolver treats a cutover observation explicitly corrected by an earlier historical assignment as audit-only for effective employment. The observation stays in the immutable timeline. A genuine later Admin change still takes effect. Leave entitlement boundaries follow the same effective revisions.

## Migration Impact

Apply only `20260929170845_people_corrected_cutover_effective_resolution.sql` after the existing historical baseline correction migration. It replaces the People resolver and the Leave entitlement boundary scan. It does not insert, update, or delete employee assignments, Joined Dates, grants, or finalized historical evidence.

## Deployment Notes

Release the isolated candidate from the current Production baseline. Verify the corrected employee's current Legal Employer resolves to Idamans Food Industry Sdn Bhd while the 29 Sep cutover remains visible in timeline/audit and is not selected for effective dates. The existing People scheduler reconciles the current Employee projection after the resolver changes.
