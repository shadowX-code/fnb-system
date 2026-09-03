# Factory Default Recipe Usage UOM Release

Date: 2026-09-03

This release adds nullable `factory_raw_materials.default_recipe_usage_uom`.
The database accepts only storage-identical or canonically reachable defaults.
It applies a default only when a user selects a Raw Material on a new Recipe BOM
line. Existing Recipe quantities, usage UOMs, production usage, storage
quantities, receiving cost bases, and Recipe statuses are unchanged.
