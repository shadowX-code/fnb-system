# Purchase Order Loading Fix

Date: 2026-09-02

## Changes

- Restored explicit Purchase Orders loading, error, and retry states.
- Prevented stale inventory refresh responses from replacing newer data.

## Migration Impact

None.

## Deployment Notes

- Release only commit `ef6ccade` onto the Production `main` baseline.
- No Purchase Order data or lifecycle contract changes.
