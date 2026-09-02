# Purchase Order Read-Path Fix

Date: 2026-09-02

## Changes

- Isolated the Purchase Orders route from unrelated Inventory Master reads.
- Added paginated Purchase Order header loading with exact-count validation.

## Migration Impact

None.

## Deployment Notes

- Release the verified `d6f1e1e9` Purchase Orders read-path fix onto the Production `main` baseline.
- No Production schema or Purchase Order data changes are required.
