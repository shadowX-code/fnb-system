# Factory External Agent module coverage

Baseline: `ef5b7893011a6a1a52d65bb72259f27b877caae3`. The catalog now has 65 bounded read resources and 97 navigation bindings. All 34 route identities, labels and six sidebar sections are unchanged. Production Reports changes from Unavailable to Partial; the result is **6 Available, 28 Partial, 0 Unavailable**. No module is promoted merely to remove a limitation.

Available means the documented bounded read contract is supported. Partial identifies excluded information, required cross-module authority, or unavailable historical evidence. It is not a compliance finding. The two Related routes remain outside the sidebar.

## Factory

| Business module | Coverage | Change from baseline | Supported scope and remaining limits |
| --- | --- | --- | --- |
| Dashboard | Partial | Clarified current monthly scope; recommendations stay excluded. | Canonical monthly analytics with explicit source-module requirements. Action recommendations and administrative filter options are excluded; analysis remains with the agent. No recent-activity feed is inferred. Source-grant requirements are returned per resource in MCP discovery. |
| Production Planning | Partial | Added canonical open-order quantity aggregate and diagnostics. | Planning records and canonical current open-order quantities with invalid/missing-data diagnostics. Open quantities require Job Order and Finished Goods access. Stock-readiness recommendations and par-level calculations remain in the Planning UI. Source-grant requirements are returned per resource in MCP discovery. |
| Production Overview | Partial | Added canonical daily pipeline buckets, states and output totals. | Monthly performance plus the canonical daily pipeline, saved lifecycle states and output totals. Pipeline requires Job Order and Production Records access; monthly performance requires its contributing modules. Requests never release or change Job Orders. Source-grant requirements are returned per resource in MCP discovery. |
| Job Order | Partial | Unchanged; existing read coverage and limits retained. | Saved order planning and lifecycle fields. Detailed product, procedure and execution data require their own modules. |
| Production Records (Related route) | Partial | Added legacy QC checkpoints and remarks-presence evidence. | Saved runs, execution steps, QC checklist results and remarks-presence flags, legacy QC checkpoints and material quantities. Personnel, remarks text and detailed linked documents are excluded. |
| Production Reports (Related route) | Partial | Unavailable → Partial: four source datasets with explicit owner grants. | Saved production, material usage, product movements and receiving cost basis. Each dataset requires its owning module. UI-calculated costing, yield ratios and cost trends are not returned as authoritative report totals; missing costs and historical usage remain unresolved. Source-grant requirements are returned per resource in MCP discovery. |
| Batch Traceability | Partial | Unchanged; existing read coverage and limits retained. | Canonical batch reconciliation and saved raw allocations. Summaries require all contributing modules; linked records are not expanded automatically. Source-grant requirements are returned per resource in MCP discovery. |
| Product Feedback | Partial | Unchanged; existing read coverage and limits retained. | Campaigns, tasting variants and anonymous daily response counts only. Answers, contacts and detailed insight analytics are excluded. |
| Petty Cash | Partial | Unchanged; existing read coverage and limits retained. | Transaction amounts, types, dates, states and categories only. Receipt files, parties and free text are excluded. |

## Warehouse

| Business module | Coverage | Change from baseline | Supported scope and remaining limits |
| --- | --- | --- | --- |
| Finished Goods | Partial | Added saved categories and price fields. | Saved SKU, packaging, price, category and batch balance records. Production history, movement documents and Location details require their owning modules; no reconstructed historical stock valuation. |
| Finished Goods Dispatch | Available | Unchanged; existing read coverage and limits retained. | Saved dispatch documents, items and batch allocations. Related customer, product and production links require their own modules. |
| Product Movements | Available | Unchanged; existing read coverage and limits retained. | Saved product movement quantities, types and dates. Related records require their own modules. |
| Product Stock Check | Partial | Added saved batch allocations and positive-adjustment confirmation. | Stock-check documents, counts, positive-adjustment confirmation and saved batch adjustment allocations. Batch and Location details require their own modules. Personal actors and free-text variance explanations are excluded. |
| Internal Transfer | Available | Unchanged; existing read coverage and limits retained. | Saved transfers and item quantities. Batch, material and location links require their own modules. |

## Raw Material

| Business module | Coverage | Change from baseline | Supported scope and remaining limits |
| --- | --- | --- | --- |
| Raw Material Receiving | Partial | Added saved receiving cost basis. | Receiving documents, items, quantities, lifecycle states and saved unit/total cost basis. Related records and MeSTI acceptance/control evidence require their own modules. Invoice files, personal contacts and free text are excluded. |
| Raw Material Inventory | Partial | Added categories and saved manual cost basis; declared conversion already existed. | Material and batch records, categories, declared UOM conversion and saved manual cost basis. Related receiving and Location records require separate access. No reconstructed historical valuation or invented conversions. |
| Raw Material Movements | Available | Unchanged; existing read coverage and limits retained. | Saved raw material movement quantities, types and dates. Related records require their own modules. |
| Raw Material Stock Check | Partial | Added saved batch allocations. | Stock-check documents, counts and saved batch adjustment allocations. Batch details require Raw Material Inventory access. Personal actors and free-text reasons are excluded. |

## MeSTI

| Business module | Coverage | Change from baseline | Supported scope and remaining limits |
| --- | --- | --- | --- |
| Cleaning of Area | Partial | Added recorded Cleaning Method procedures and immutable issued-method provenance; legacy unspecified methods stay unavailable. | Area-cleaning requirement versions, recurrence, saved states and redacted proof with recorded Cleaning Method reference procedures. Issued records use their saved method snapshot; legacy unspecified methods remain unavailable. Locations require separate access. |
| Cleaning of Equipment | Partial | Added recorded Cleaning Method procedures and immutable issued-method provenance; legacy unspecified methods stay unavailable. | Equipment-cleaning requirement versions, recurrence, saved states and redacted proof with recorded Cleaning Method reference procedures. Issued records use their saved method snapshot; legacy unspecified methods remain unavailable. Equipment and Production identities require separate access. |
| Calibration Schedule & Record | Partial | Unchanged; existing read coverage and limits retained. | Calibration requirements, due dates, saved results and verification states only. Equipment details require Equipment access. |
| Finished Product Storage Control | Partial | Added canonical quantities/UOM and completion fields; enabled Production End schedules. | Canonical completed-production storage quantities, packaging UOM, completion date/time, batch provenance and expiry. Production, product and Location identities require their own modules. No temperature telemetry or reconstructed historical storage conditions. |
| Health Declaration | Partial | Unchanged; existing read coverage and limits retained. | Daily non-voided declaration counts only. Individual health records and required-personnel coverage are unavailable to agents. |
| Operator Hygiene Inspection | Partial | Unchanged; existing read coverage and limits retained. | Saved sessions and aggregate proof only. Individual results and required-personnel coverage are unavailable to agents. |
| Waste Disposal Record | Partial | Unchanged; existing read coverage and limits retained. | Waste requirements, schedules, sessions and events only. Grant Locations separately to identify linked areas. |
| Raw Material Control | Available | Aligned with canonical active standards and completed Receiving only; added saved lifecycle/verification evidence. | Canonical active acceptance/control standards and completed Receiving evidence, including saved verification state and frozen guidance. Material, Receiving, Supplier and Location identities require their own modules. No stock balances, costs, contacts or actors. |
| Food Processing Control | Partial | Added canonical QC requirement/evidence summary, output and completion fields; enabled Production End schedules. | Canonical completed-production lifecycle, output quantities, QC requirement/evidence counts, No QC Required versus Evidence unavailable, and redacted saved QC proof. Staff and free-text results are excluded; historical SOP edits are not reconstructed. |

## Master Data

| Business module | Coverage | Change from baseline | Supported scope and remaining limits |
| --- | --- | --- | --- |
| Product Recipes | Partial | Added product-family tags. | Recipe versions, ingredient quantities, product families and family tags. Material details and costs require Raw Material Inventory access. Personal actors, free-text remarks and historical edits are excluded. |
| Production SOP | Partial | Added substeps, material/equipment bindings, QC definitions and checklist result mode. | Procedure versions, main steps, substeps, QC definitions and equipment bindings. Equipment and Recipe details require their own modules. Free-text remarks and unpublished historical edits are excluded. |
| Equipment | Partial | Added Equipment categories. | Equipment masters, categories and saved state. Locations and SOP bindings require their owning modules. No equipment-usage ledger or historical assignment reconstruction is invented. |

## System

| Business module | Coverage | Change from baseline | Supported scope and remaining limits |
| --- | --- | --- | --- |
| Audit Trail | Partial | Unchanged; existing read coverage and limits retained. | Event classifications, outcomes and times only, for other granted business modules. Actors, before/after details and unclassified events are omitted. |
| Locations | Available | Unchanged; existing read coverage and limits retained. | Location master records only. Inventory contents and operational documents require their own modules. |
| Suppliers | Partial | Added saved Supplier ↔ Raw Material eligibility links. | Supplier identifiers, names, state and saved material-eligibility links. Material details require Raw Material Inventory access. Personal contacts, free text and historical eligibility reconstruction are excluded. |
| Customers | Partial | Unchanged; existing read coverage and limits retained. | Customer identifiers, names, type and state only. Contacts, addresses and linked dispatch details are not included. |

## Canonical reuse and isolation

Food Processing Control, Finished Product Storage Control, Raw Material Control standards/receiving, the operational pipeline and open-order quantities use shared cores of the same existing Factory RPCs. Human RPC signatures, permission gates, security mode, RLS behavior and grants remain intact. The Gateway projects explicit fields from those cores. It never invokes the UI loader’s `factory_release_due_job_orders` step. Saved child records use the same tables selected by `factoryService`; no second lifecycle, stock calculation or evidence ledger is created.

Production Reports exposes saved Production, usage, movement and receiving-cost inputs. UI-calculated costing, yield ratios and cost trends are not duplicated in SQL or presented as authoritative Gateway totals. Missing receiving costs remain null/missing, never an invented zero.

New resources require explicit navigation-module grants. Source-dependent queries require every contributing module before reading. Discovery includes only executable operations, plus a supported-resource catalog that explains missing grants and returns only authorized field/filter names. Relationships, including nested source payloads, are removed before predicates and paging. Pipeline jobs are flattened; nested staff, QC and product objects never pass through. MeSTI composite references stay module-scoped.

Open-order planning data is the current aggregate across all planning dates. Pipeline queries classify current open jobs against requested operational dates; they do not reconstruct historical job states. Completed output and MeSTI production evidence use canonical Production End. Master data is current. Stock-adjustment allocation dates follow the parent check date.

Food Processing reports a pinned-SOP resolution gap rather than inventing No QC Required. Storage retains an explicit unavailable context when its canonical batch projection is missing or ambiguous; no arbitrary batch, quantity, expiry or Location is selected.

## Remaining genuine limitations

- Privacy: individual health/hygiene data, personnel/actors, contacts, private feedback answers, receipt/invoice files, and free-text remarks remain excluded. Health and hygiene still lack a canonical required-personnel denominator.
- Authority: foreign module records and source-dependent summaries require separate grants. Connect and Manage Access never add those grants implicitly.
- History: missing dated records, unresolved pinned versions, old allocation evidence, historical eligibility/master edits and past stock valuations are not reconstructed.
- Unsupported source capability: no temperature telemetry, Equipment-usage ledger, or server-owned Planning readiness/production costing report calculation is invented. Saved inputs and coverage limits are exposed instead.
- Staging data: several transactional sources are empty. Canonical source calls, contracts and synthetic JSON projection tests cover those paths; no Factory records are created for QA.

## QA Executive and legacy retirement

The existing credential and exact two permission codes remain unchanged. Its migrated `mesti_review` resource returns exactly the established redacted inspection rows; no full MeSTI navigation grant is inferred. Other implemented resources remain denied. The five legacy aliases are a compatibility adapter to that same inspection authority, not separate business logic.

Retirement remains blocked by provider-side confirmation: the accessible Grok Custom Connector step shows Name and Server URL, without a Bearer/header field at that step. No authenticated `query_factory_resources` invocation from the actual “QA Executive - Idamans” Bot has been confirmed. This is not replaced by an xAI API request or a FeedX connection probe. Keep the aliases until that Bot successfully discovers the unified tool, reads its existing `mesti_review` scope and receives expected denials without broader grants. Official connector setup: [Grok connectors](https://docs.x.ai/grok/connectors). No secret was entered into a URL or chat.

Cleaning Method reads preserve each versioned requirement or issued occurrence’s captured reference. Nested reference keys are allowlisted; personal or unknown keys cannot pass through. Missing legacy methods remain unavailable, with no fallback to current setup. Raw Material Control uses its exact canonical active-standard/completed-document projections; drafts and cancelled receiving are not compliance evidence.
