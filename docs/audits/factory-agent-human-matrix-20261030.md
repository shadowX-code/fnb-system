# Factory Human Matrix / Agent capability separation

## Owning defect and correction

All 33 navigation-module registrations omitted the existing `permissionEditorHidden` flag; 65 resource metadata registrations already had it. The separate `factory_mesti_inspection.view` connection prerequisite was also presented as a human inspection module. These 34 entries are now hidden from Human Role Matrix read/edit selectors without changing permission definitions, capability catalogs, routes, RPCs, grants or source policies. No migration is required.

## Entry classification

Every currently displayed External Agent module below is an **Agent-only capability**, not the similarly labelled human business permission. All retain their exact permission codes and bounded Gateway enforcement; AI Integrations remains their management surface.

| Code | Business scope | Classification |
| --- | --- | --- |
| `factory_agent_nav_factory_dashboard.view` | Factory / Dashboard | Agent-only capability |
| `factory_agent_nav_factory_production_planning.view` | Factory / Production Planning | Agent-only capability |
| `factory_agent_nav_factory_job_orders.view` | Factory / Production Overview | Agent-only capability |
| `factory_agent_nav_factory_job_order_records.view` | Factory / Job Order | Agent-only capability |
| `factory_agent_nav_factory_production.view` | Factory / Production Records | Agent-only capability |
| `factory_agent_nav_factory_batch_traceability.view` | Factory / Batch Traceability | Agent-only capability |
| `factory_agent_nav_factory_product_feedback.view` | Factory / Product Feedback | Agent-only capability |
| `factory_agent_nav_factory_petty_cash.view` | Factory / Petty Cash | Agent-only capability |
| `factory_agent_nav_factory_finished_goods.view` | Warehouse / Finished Goods | Agent-only capability |
| `factory_agent_nav_factory_finished_goods_dispatch.view` | Warehouse / Finished Goods Dispatch | Agent-only capability |
| `factory_agent_nav_factory_product_movements.view` | Warehouse / Product Movements | Agent-only capability |
| `factory_agent_nav_factory_product_stock_check.view` | Warehouse / Product Stock Check | Agent-only capability |
| `factory_agent_nav_factory_internal_transfer.view` | Warehouse / Internal Transfer | Agent-only capability |
| `factory_agent_nav_factory_raw_receiving.view` | Raw Material / Raw Material Receiving | Agent-only capability |
| `factory_agent_nav_factory_raw_inventory.view` | Raw Material / Raw Material Inventory | Agent-only capability |
| `factory_agent_nav_factory_raw_movements.view` | Raw Material / Raw Material Movements | Agent-only capability |
| `factory_agent_nav_factory_raw_stock_check.view` | Raw Material / Raw Material Stock Check | Agent-only capability |
| `factory_agent_nav_factory_mesti_cleaning.view` | MeSTI / Cleaning of Area | Agent-only capability |
| `factory_agent_nav_factory_mesti_equipment_cleaning.view` | MeSTI / Cleaning of Equipment | Agent-only capability |
| `factory_agent_nav_factory_mesti_calibration.view` | MeSTI / Calibration Schedule & Record | Agent-only capability |
| `factory_agent_nav_factory_mesti_finished_product_storage_control.view` | MeSTI / Finished Product Storage Control | Agent-only capability |
| `factory_agent_nav_factory_mesti_health_declaration.view` | MeSTI / Health Declaration | Agent-only capability |
| `factory_agent_nav_factory_mesti_operator_hygiene.view` | MeSTI / Operator Hygiene Inspection | Agent-only capability |
| `factory_agent_nav_factory_mesti_waste_disposal.view` | MeSTI / Waste Disposal Record | Agent-only capability |
| `factory_agent_nav_factory_mesti_raw_material_control.view` | MeSTI / Raw Material Control | Agent-only capability |
| `factory_agent_nav_factory_mesti_food_processing_control.view` | MeSTI / Food Processing Control | Agent-only capability |
| `factory_agent_nav_factory_product_recipes.view` | Master Data / Product Recipes | Agent-only capability |
| `factory_agent_nav_factory_production_sop.view` | Master Data / Production SOP | Agent-only capability |
| `factory_agent_nav_factory_equipment.view` | Master Data / Equipment | Agent-only capability |
| `factory_agent_nav_factory_audit_logs.view` | System / Audit Trail | Agent-only capability |
| `factory_agent_nav_factory_storage_locations.view` | System / Locations | Agent-only capability |
| `factory_agent_nav_factory_suppliers.view` | System / Suppliers | Agent-only capability |
| `factory_agent_nav_factory_customers.view` | System / Customers | Agent-only capability |
| `factory_mesti_inspection.view` | Factory adapter connection prerequisite | Agent-only capability |

- `factory_agent_<resource>.view`: the 65 resource metadata definitions are already hidden. Fifty have retained catalog/capability entries (including the granted `factory_agent_mesti_review.view`); fifteen are metadata without permission rows. These are **Legacy compatibility permission / agent-only metadata**, never new human CRUD authority. No definitions are deleted or manufactured.
- `factory_mesti_resource_{requirements,occurrences,evidence,statuses,schedules}.{list,read,search,filter}`: 20 **Legacy compatibility permissions** for internal token-bound resource operations, already absent from the Human Matrix; retained unchanged.
- The ordinary `factory_*` business module action codes are **Human business permissions** and remain selectable. Similar labels do not make them interchangeable with `factory_agent_nav_*`.
- The domain read cores are **Shared backend authority**. The null-token branch enforces the original human permission/RLS, while the Gateway branch validates a machine credential, adapter prerequisite, explicit navigation grant, resource binding, source dependencies and redaction. Sharing a core never shares or substitutes grants.

## Final Human Factory Matrix

Thirty existing owning permission rows remain in six sections:

| Section | Rows |
| --- | --- |
| Factory | Dashboard; Production Planning; Production Overview; Production Records; Production Reports; Batch Traceability; Product Feedback; Petty Cash |
| Warehouse | Finished Goods; Finished Goods Dispatch; Product Movements; Product Stock Check; Internal Transfer |
| Raw Material | Raw Material Receiving; Raw Material Inventory; Raw Material Movements; Raw Material Stock Check |
| MeSTI | Cleaning of Area; Cleaning of Equipment; Calibration Schedule & Record; Health Declaration; Operator Hygiene Inspection; Waste Disposal Record |
| Master Data | Product Recipes; Production SOP; Equipment |
| System | Audit Trail; Locations; Suppliers; Customers |

Composite read-only screens keep their intentional source-module authority rather than gaining page-specific permissions. Production Records/Raw Receiving Verify, stock approvals, MeSTI record/review and all distinct human actions remain registered.

## Preservation and verification

L3 focused verification: registry separation and complete-definition retention, Human Matrix read/edit rendering, mounted role-editor metadata and one-human-revocation payloads, service/save contracts, Gateway routing/redaction/dependencies, capability selector/agent management regressions and build. `supabase/tests/role_hidden_agent_grant_preservation.sql` clones the existing labelled agent role inside a rollback-only transaction, exercises metadata save, one human grant addition, retry and explicit revocation, and checks every hidden grant survives. No real role is saved for QA.

Before delivery, Staging contained 975 role-grant rows, 103 capability definitions and one connected agent role with six grants: four navigation grants, the connection prerequisite and the retained MeSTI review scope. Capture/read-back fingerprints cover all role grants, permission catalog, capability definitions, navigation policies, identity/credential metadata and the authenticated AI Integrations effective-access projection. UI-only deployment must leave all unchanged. Authenticated browser smoke verifies no agent-only rows in the Factory Human Matrix and the same existing agent capability selection in AI Integrations without confirming changes.
