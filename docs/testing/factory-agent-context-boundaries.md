# Factory Gateway context boundary audit

97 current mappings audited. 84 contain essential reference policies (some references are not present in every resource's field allowlist). All approved context is scalar identifiers, business names/codes or pinned version numbers; no inventory quantities, costs, personal identities or unrestricted nested objects are classified as context. Thirteen mappings need no related-context policy. No grants are added or inferred.

`navigation_resources.context_fields` declares contextual source owners. `navigation_project_row` copies only existing authorized fields and adds fixed minimal lookups. Related master labels/statuses are marked `current_related_record`; they never assert historical truth. Operational line/batch references without an approved label projection remain `identifier_only`; broken references are `unavailable`. Original saved reference IDs, business dates, statuses, snapshots and module-scoped composite IDs remain canonical. Master records cannot be independently enumerated/read with a contextual reference. Generic restricted grants retain their prior projection.

Nine mappings deliberately remain source-gated:

| Capability | Resource(s) | Why separate access remains |
|---|---|---|
| Dashboard | Monthly operational dashboard | Combines inventory, production, dispatch, receiving and stock-check measures, rather than minimal record context. |
| Production Overview | Monthly performance, pipeline, production records, material usage, product movements, receiving cost basis | Exposes full operational records/quantities, cross-domain metrics and explicit costs. Original source capabilities remain required per resource. |
| Production Planning | Open planned quantities | Aggregates open Job Order quantities by SKU. Job Order and Finished Goods source permissions remain required. Planning records themselves are independently readable. |
| Batch Traceability | Finished batch traceability | Includes stock balances, dispatch quantities, reconciliation and production provenance. All original contributing-domain grants remain required. Material-allocation records retain their independent declared projection. |

Audit Trail is additionally owner-filtered: its grant alone does not expose other modules' security/business activity. These are explicit composite-resource boundaries, not missing scalar reference context. No automatic dependencies, alternate authorization authority or business writes are introduced.

Verification: `qa/staging/factoryStandaloneContext.rollback.sql` creates one disposable security identity per implemented capability, queries every mapping with only that grant, compares context against saved canonical projections and asserts all nine source denials, cross-module rejection and strict nested-context fields. All fixtures and audit events roll back. Existing navigation, read-coverage, dependency, staged review and resource MCP regression tests remain applicable with scalar-reference expectations updated.

## Review / MCP all-source parity

`qa/staging/effectiveAccessAllSources.rollback.sql` verifies the Planning → Finished Goods scenario against the actual MCP query RPC after explicit fixture confirmation. Planning plus Finished Goods remains unreadable for Open Planned Quantities without Job Order; the review reports exactly Job Order as missing. Adding the final required grant permits the query. The actual QA Executive baseline already contains Job Order, so adding Finished Goods correctly completes its source requirements. The investigation does not change that agent's grants.

The same regression omits each source for all nine source-gated mappings (28 omissions) and restores every complete source set (28 successful reads), checking the review snapshot, exact missing permission and post-confirmation MCP authorization. All security fixtures and audit events roll back; no business records change. This is regression coverage of existing all-source enforcement, not a new authorization rule.
