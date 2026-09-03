# Factory Recipe UOM Conversions

Date: 2026-09-03

## Changes

- Preserves canonical recipe codes when saving existing draft recipes.
- Calculates same-UOM package costs and preserves Receiving `receipt_no` provenance.
- Adds independent Recipe Usage UOM and structured Raw Material package-content metadata.
- Validates Recipe-linked Production usage against canonical UOM conversion before stock deduction.

## Migration Impact

- Adds nullable conversion metadata to Raw Materials and `recipe_usage_uom` to BOM rows.
- Backfills only `recipe_usage_uom` from the existing BOM UOM. It does not change quantities, existing UOM values, recipe status, or conversion assumptions.
- Maintains Production completion compatibility when the later MeSTI equipment-cleaning materializer is absent.

## Deployment Notes

- Apply the Recipe migrations in version order before deploying the matching application build.
- Ambiguous historical package quantities remain pending human-confirmed data remediation.
