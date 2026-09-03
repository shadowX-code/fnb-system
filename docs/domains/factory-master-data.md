# Factory Master Data

## Purpose And Scope

This domain owns Factory Product Recipes/BOM, Production SOP, Factory Location/reference master data, MeSTI Cleaning and Calibration setup configuration, and Factory-owned suppliers and customers.

## Canonical Ownership

Current Factory master-data services, migrations, trusted save authorities, RLS, routes, and tests are authoritative.
Factory Production and Warehouse consume this data but own execution evidence and stock state respectively.
Restaurant suppliers and recipes remain restaurant-owned unless a deliberate shared contract exists.

## Core Entities

- Factory products and raw materials
- Product Recipe/BOM drafts, versions, components, quantities, units, and yield context
- Production SOP records, versions, attachments, and status
- Factory Locations and other Factory reference/configuration records
- Factory Equipment categories and equipment instances
- MeSTI Cleaning of Area and Cleaning of Equipment Requirements
- MeSTI Calibration Settings, versioned Requirements, Schedule, and immutable Records
- Factory suppliers and customers

## Lifecycle And Business Rules

Product Recipe/BOM Draft saves use the established trusted save authority so header and component changes remain atomic and validated.
Published or execution-ready recipes and SOPs are versioned or pinned according to current contracts.
Later edits must not rewrite the recipe, BOM, or SOP context attached to historical production.

Master-data records may be retired or made inactive according to current state rules, but referenced history remains valid.
Factory Location is the canonical physical-location master. The legacy internal `factory_storage_locations` contract remains stable for compatibility, while user-facing UI labels it as Location. `is_storage_location` controls whether an active Location may be selected by raw material, receiving, production output, finished goods, and stock workflows. Non-storage active Locations may still be referenced by appropriate non-inventory Factory workflows such as MeSTI Cleaning.

Factory Equipment is Factory-owned and separate from Restaurant Asset Tracking. Each equipment instance has one canonical current Factory Location, an optional Factory Equipment Category, and a lifecycle status. Active equipment is eligible for new Production SOP bindings; inactive, maintenance, and out-of-service equipment remain readable through immutable production and compliance snapshots.

MeSTI Cleaning of Area Requirements bind tasks directly to one or more canonical Factory Locations. MeSTI Cleaning of Equipment has two canonical sources: scheduled Requirements bind tasks to active Equipment on a daily or selected-weekday recurrence, while After Production occurrences are created only when a completed Production uses a canonical Equipment binding from its pinned Production SOP. After Production is not a configurable Requirement and does not rely on free text, manual actual-equipment entry, recipes, or batch creation. Both workflows preserve immutable occurrence evidence; scheduled Requirements use stable logical identities with forward-effective versions and equivalent saves are no-ops.

MeSTI Calibration Requirements bind one active Factory Equipment instance and Calibration Type to one logical, forward-effective version lineage. The server rejects duplicate active Equipment plus Calibration Type pairs, identical saves return the current version without mutation, and a real edit creates one non-overlapping successor version without rewriting prior records. Schedule and Records are trusted RPC projections. Only a verified Pass becomes Last Valid Calibration and advances Next Due; a verified Fail remains permanent evidence, projects as Failed, and never renews validity. A later verified Pass is the only recovery path. Recording and verification require the respective canonical FeedX permissions server-side, and an employee cannot verify their own record. Equipment, category, and Location are snapshotted when a record is created so later master-data or requirement changes cannot rewrite history.

Cleaning Occurrences are generated/materialized by trusted database authorities and preserve immutable requirement/source snapshots. Area occurrences are unique by logical requirement, Location, and due date. Equipment scheduled occurrences are unique by logical requirement, Equipment, and due date; After Operation occurrences are unique by logical requirement and actual Production Equipment Usage event. Daily is Location- or Equipment-centric as applicable. Monthly is a canonical task-centric projection keyed by logical requirement identity, with per-date aggregate state and retained drill-down evidence.

Units, quantities, product/material relationships, storage eligibility, recurrence configuration, and duplicate constraints are server-validated where protected.

## Permissions, Versions, And Audit

Admin access requires the relevant Factory master-data permission and applicable scope.
Trusted saves derive actors server-side and use explicit grants.
Recipe/BOM versions, SOP publication/version state, material relationships, MeSTI Cleaning completion/verification evidence, MeSTI Calibration requirement/record/verification evidence, and meaningful supplier/customer/location changes retain auditability.

MeSTI Cleaning of Area, Cleaning of Equipment, and Calibration use canonical FeedX permissions as their only authorization source: view read models, create/edit/manage requirement setup, complete recordable work, and review verification or unsatisfactory outcomes. Module-specific Responsible/Verifier role mappings do not exist. The same employee cannot verify their own completion or calibration record. The server derives the actual completing and verifying employee from Admin Auth through the canonical employee/Auth link.

## Workflows And Integrations

Authorized Admins maintain products/materials, compose and version recipes/BOM, manage production SOPs, configure Locations, MeSTI Cleaning Requirements and Calibration requirements, and maintain supplier and customer records.
Factory Production pins the appropriate master-data versions for planning and execution.
Factory Warehouse consumes material, product, storage, supplier, and customer references for receipts, movements, and dispatch.
Factory Production consumes canonical Equipment bindings from the pinned Production SOP at completion; free-text SOP instructions remain instructional and are not a trigger. Factory MeSTI Cleaning of Area consumes canonical Locations and canonical permissions while owning its daily/monthly compliance occurrence evidence. Cleaning of Equipment consumes canonical Equipment and completed Production SOP bindings while owning its own idempotent, provenance-preserving occurrence evidence.
Factory MeSTI Calibration consumes Factory Equipment and canonical permissions while owning its versioned schedule and immutable calibration evidence.

## Compatibility And Deferred Scope

Product Recipes/BOM, Production SOP, Locations, MeSTI Cleaning and Calibration setup, Suppliers, and Customers are grouped here because they are Factory reference authorities.
Historical refactor documents remain deep reference only.
Product lifecycle management, supplier portals, customer CRM, and cross-company master-data federation are deferred unless explicitly introduced.
