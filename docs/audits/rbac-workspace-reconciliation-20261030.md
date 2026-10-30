# Staging RBAC reconciliation — 30 October 2026

Registry audit baseline: 482 generated codes, 525 database codes. Twenty generated codes were absent and 63 database codes were outside the generated list. This comparison includes hidden/internal authorities, not only selectable UI actions.

## Corrections

- Finance has seven consumer routes using reports.view; its filter now exposes that same shared View grant, with an explicit shared-authority label, without inventing Finance permissions or exposing Reports Export as Finance authority.
- HR's seven business permission modules retain their codes; shared Roles is visible in HR Settings using the existing platform codes. AI Integrations remains a consumer of roles.view OR roles_permissions.view, not an independent grant.
- Customer Feedback maps its module identity to the existing crew_feedback.view/moderate codes, removing two nonexistent generated codes.
- MeSTI Record/Verify were declared in module metadata and enforced by backend functions but absent from action ordering/type/labels. Their three existing codes now appear.

## Remaining differences

After these corrections: 15 generated codes remain absent from the catalog; 58 database codes remain outside the generated list. None was deleted or silently migrated.

- 15 absent factory_agent_* resource View codes belong to hidden internal resource metadata, not selectable active matrix rows. Reconcile with the Gateway resource registry in a separate authority change; do not create human grants from them.
- Unbacked selectable exports removed: factory_mesti_cleaning.export, factory_mesti_equipment_cleaning.export, factory_storage_locations.export. None exists in the catalog or has grants; no backend/export workflow was removed. Any future independent export grant requires an owning catalog/authority implementation.
- 20 outside-registry factory_mesti_resource_* list/read/search/filter codes belong to internal resource authority; retained, currently ungranted.
- 14 compatibility codes: duty_roster.*, outlet_duty_roster.*, crew_sop.* and roles_permissions.*. Existing active grants and alias enforcement are retained.
- 21 active outside-registry codes: employee_disciplinary.*, employee_employment_documents.*, employment_contract_templates.*, crew_feedback attribution/trust/follow-up, data_import.*, factory_product_families.*, factory_settings.*. These require full owning-module catalog presentation work; current grants are preserved by the server patch contract.
- factory_production.verify and factory_raw_receiving.verify are ungranted; investigate supported workflows before retirement.
- payroll.manage is ungranted and explicitly rejected by the current save authority; retained ledger/catalog history, not exposed as an active action.

No duplicated module IDs or permission codes were found in registry generation. Workspace counts include internal modules: Restaurant 36, HR 8, Finance 7, Marketing 21, Factory 133, Crew 25, Guest AI 7. A sidebar consumer is not an independent permission authority.

## Preservation verification

The previous editor filtered initial and submitted grants to its UI registry. The trusted exact-snapshot RPC then deleted every omitted grant. The replacement applies explicit changes to current server grants under a role lock, compares observed values for touched grants, and records request intent for retry safety. The snapshot helper is not executable by API roles; legacy snapshot edits fail closed.

Rollback-only SQL in supabase/tests/role_explicit_grant_changes.sql clones Manager's complete grants, tests metadata save, exact one-code revocation, stale conflict rejection, non-overlapping edit merging, lost-response retry and anonymous/internal-helper denial. Every fixture/audit/request write is rolled back. The real Manager remains 114 grants, including all 13 originally outside-registry grants (fingerprint 5a8bef580f287800338c5613f8505578).
