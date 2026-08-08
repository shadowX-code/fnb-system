# Factory V1 Staging Sign-off

Date: 2026-08-08

## Scope

Factory V1 covers Production Planning, Job Orders, Production Start/QC/Complete, Raw Material Receiving, exact Raw Material batch allocation, Finished Goods, Dispatch, Stock Checks, movement ledgers, Batch Traceability, Recipe/BOM, Production SOP, commercial Finished Goods fields, and Factory Audit Trail.

## Certification Result

- **Owner runtime smoke**: passed for Production Complete, Recipe Activate, SOP Activate, Receiving Create, Recipe Archive, Finished Goods Edit, and Raw Material Edit.
- **Operator permission smoke**: passed for the approved operational actions; restricted authority did not grant unrelated master-data or approval powers.
- **Read-only permission smoke**: passed; authorized views remained available while mutation controls and protected routes were unavailable.
- **Permission-boundary static audit**: passed for the current Factory trusted-RPC/RLS model, including server-derived active employee authority.
- **Migration level**: permission hardening is current through `202608050031_factory_permission_boundary_hardening.sql`.

## Non-blocking Follow-ups

- Align the disabled Finished Goods Dispatch Create presentation with the read-only experience.
- Investigate the employee-login timestamp console warning separately from Factory business workflows.
- Deliver the FactoryWorkspacePage/factoryService maintainability refactor as a P1 behavior-preserving effort.
- Review retirement of legacy Factory permissions and RPC compatibility paths only after usage and historical-data verification.

This is an operational staging sign-off, not an independent penetration test or exhaustive security certification.
