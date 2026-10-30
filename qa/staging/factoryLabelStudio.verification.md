# Factory Label Studio — focused Staging verification

QA level: L2 Workflow. Canonical target: `fnb-system-staging` / `ujkzdaaadnvcfayuldmh`. No schema, RPC, grants, lifecycle, snapshot, transport or Production release changes.

- Focused label, renderer, route ownership/completeness, Finished Goods and service/permission consumers: 11 files / 59 passing tests. Follow-up confirmation: 3 files / 12 passing tests. Build and whitespace checks pass; mechanical UI scan has no findings.
- S01 Black Pepper Sauce reproduced the old unconfigured editor's S08 ingredient value. Root cause: the working-copy initializer copied template reference ingredients/manufacturer text into every SKU. New copies use canonical SKU identity and explicit SKU content only; missing ingredients/manufacturer text stays empty. Existing saved or approved content remains intact and reference-matching values receive review feedback.
- The original S08 reference definition retains its legacy compatibility binding. Template working copies convert those elements to explicit SKU fields. New templates' static captions do not acquire implicit SKU bindings. Published layouts and frozen print pixels remain unchanged.
- Canonical authenticated browser checks cover S01 English/Chinese/Malay names, weight, empty ingredients and preview, content/Production/history navigation, template Layers/Canvas/Properties, the consolidated Add Element menu, source-specific properties, keyboard movement and ordering. Test interactions were restored without saving or publishing business content.
- Long S01 content produces visible field overflow and disables Review & Publish. Renderer checks prove valid editor/print rasters match, overflowing drafts yield no printable raster, font size does not shrink, and the 2 mm edge check is advisory. Fit/Zoom and guides are editor-only state.
- Desktop and mobile viewport review confirms responsive composition and no document horizontal overflow. Visibility persistence remains unsupported by the existing schema; no hidden-layer authority was added. D520 physical calibration/printing acceptance remains pending from the original printing implementation.

Existing Job Order printing/reprinting tests remain in the focused suite. The broader Factory baseline was not rerun for this UI/data-binding change.
