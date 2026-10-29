# Factory External Agent module coverage

This is the navigation-aligned read contract for the existing 50 resources. Available/Partial do not grant write or approval actions. The two Related routes are hidden from the Factory sidebar.

## Factory

| Business module | Coverage | Scope and limitations |
| --- | --- | --- |
| Dashboard | Partial | Monthly analytics only. Requires the contributing Production, Warehouse, Raw Material and master-data modules; no recent-activity feed. Required modules: Job Order, Production Records, Finished Goods, Finished Goods Dispatch, Product Stock Check, Raw Material Receiving, Raw Material Inventory, Raw Material Movements, Raw Material Stock Check, Product Recipes. |
| Production Planning | Partial | Planning dates, status and target quantities only. Stock readiness, par-level calculations and execution details are not included. |
| Production Overview | Partial | Monthly production performance only. Requires its contributing modules; operational pipeline panels are not included. Required modules: Job Order, Production Records, Finished Goods, Product Recipes. |
| Job Order | Partial | Saved order planning and lifecycle fields. Detailed product, procedure and execution data require their own modules. |
| Production Records (Related route) | Partial | Saved runs, execution steps, checklist QC and material quantities. Personnel, free-text QC, and detailed linked documents are excluded. |
| Production Reports (Related route) | Unavailable | The existing read resources do not cover this route’s costing, yield and material-usage reports. Production Overview performance is not an equivalent substitute. |
| Batch Traceability | Partial | Canonical batch reconciliation and saved raw allocations. Summaries require all contributing modules; linked records are not expanded automatically. Required modules: Production Records, Finished Goods, Finished Goods Dispatch, Product Stock Check, Production SOP, Locations. |
| Product Feedback | Partial | Campaigns, tasting variants and anonymous daily response counts only. Answers, contacts and detailed insight analytics are excluded. |
| Petty Cash | Partial | Transaction amounts, types, dates, states and categories only. Receipt files, parties and free text are excluded. |

## Warehouse

| Business module | Coverage | Scope and limitations |
| --- | --- | --- |
| Finished Goods | Partial | SKU and batch balances. Production history, movements and other operational documents require their own modules. |
| Finished Goods Dispatch | Available | Saved dispatch documents, items and batch allocations. Related customer, product and production links require their own modules. |
| Product Movements | Available | Saved product movement quantities, types and dates. Related records require their own modules. |
| Product Stock Check | Partial | Stock-check documents and counts. Adjustment allocation evidence and free-text variance explanations are not included. |
| Internal Transfer | Available | Saved transfers and item quantities. Batch, material and location links require their own modules. |

## Raw Material

| Business module | Coverage | Scope and limitations |
| --- | --- | --- |
| Raw Material Receiving | Partial | Receiving documents, items, quantities and dates. Costs, invoice details and control-method evidence are not part of this read scope. |
| Raw Material Inventory | Partial | Material and batch records. Cost valuation, full conversion and category setup are not included. |
| Raw Material Movements | Available | Saved raw material movement quantities, types and dates. Related records require their own modules. |
| Raw Material Stock Check | Partial | Stock-check documents and counts. Batch adjustment allocation evidence and free-text reasons are not included. |

## MeSTI

| Business module | Coverage | Scope and limitations |
| --- | --- | --- |
| Cleaning of Area | Partial | Area-cleaning requirements, schedules, saved states and redacted proof only. Grant Locations separately to identify linked areas. |
| Cleaning of Equipment | Partial | Equipment-cleaning requirements, schedules, saved states and redacted proof only. Equipment and Production links require their own modules. |
| Calibration Schedule & Record | Partial | Calibration requirements, due dates, saved results and verification states only. Equipment details require Equipment access. |
| Finished Product Storage Control | Partial | Completed-production storage provenance and dates only. No temperature or storage-condition telemetry; Production and Locations links require separate access. |
| Health Declaration | Partial | Daily non-voided declaration counts only. Individual health records and required-personnel coverage are unavailable to agents. |
| Operator Hygiene Inspection | Partial | Saved sessions and aggregate proof only. Individual results and required-personnel coverage are unavailable to agents. |
| Waste Disposal Record | Partial | Waste requirements, schedules, sessions and events only. Grant Locations separately to identify linked areas. |
| Raw Material Control | Available | Raw material acceptance/control standards and their saved receiving evidence. No inventory quantities or commercial details. |
| Food Processing Control | Partial | Completed-production lifecycle and redacted QC proof only. Staff, free-text results, procedure setup and detailed Production records are excluded. |

## Master Data

| Business module | Coverage | Scope and limitations |
| --- | --- | --- |
| Product Recipes | Partial | Recipe versions, ingredient quantities and product families only. Material details require Raw Material Inventory; tags and categories are not included. |
| Production SOP | Partial | Procedure versions and main steps only. Substeps, equipment bindings and full QC setup are not covered by the existing resources. |
| Equipment | Partial | Equipment master records only. Usage history, categories and bindings are not included; Locations require separate access. |

## System

| Business module | Coverage | Scope and limitations |
| --- | --- | --- |
| Audit Trail | Partial | Event classifications, outcomes and times only, for other granted business modules. Actors, before/after details and unclassified events are omitted. |
| Locations | Available | Location master records only. Inventory contents and operational documents require their own modules. |
| Suppliers | Partial | Supplier identifiers, names and state only. Contacts and supplier-material eligibility links are not included. |
| Customers | Partial | Customer identifiers, names, type and state only. Contacts, addresses and linked dispatch details are not included. |

Existing QA Executive review access is preserved for the eight original MeSTI modules. It does not grant Raw Material Control or full raw module data, and no broader module grants were inferred.

The remaining isolation gaps are explicit dependencies/omissions above, not UI-only security controls. Server policy denies cross-module access and removes unauthorized linked fields before predicates or paging.
