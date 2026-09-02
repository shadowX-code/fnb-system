# Factory Master Data

## Purpose And Scope

This domain owns Factory Product Recipes/BOM, Production SOP, Factory Location/reference master data, MeSTI Cleaning setup configuration, and Factory-owned suppliers and customers.

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
- MeSTI Cleaning Requirements
- Factory suppliers and customers

## Lifecycle And Business Rules

Product Recipe/BOM Draft saves use the established trusted save authority so header and component changes remain atomic and validated.
Published or execution-ready recipes and SOPs are versioned or pinned according to current contracts.
Later edits must not rewrite the recipe, BOM, or SOP context attached to historical production.

Master-data records may be retired or made inactive according to current state rules, but referenced history remains valid.
Factory Location is the canonical physical-location master. The legacy internal `factory_storage_locations` contract remains stable for compatibility, while user-facing UI labels it as Location. `is_storage_location` controls whether an active Location may be selected by raw material, receiving, production output, finished goods, and stock workflows. Non-storage active Locations may still be referenced by appropriate non-inventory Factory workflows such as MeSTI Cleaning.

Factory Equipment is Factory-owned and separate from Restaurant Asset Tracking. Each equipment instance has one canonical current Factory Location, an optional Factory Equipment Category, and a lifecycle status. Active equipment is eligible for new Production selection; inactive, maintenance, and out-of-service equipment remain readable through immutable usage history.

MeSTI Cleaning Requirements bind tasks directly to one or more canonical Factory Locations. They define the task, structured recurrence, active status, and effective-from/version boundary. Responsible and verifier roles are a single canonical Cleaning Settings record for the module, not per-requirement overrides. Daily and selected-weekday weekly recurrence are stored as structured fields; frequency labels are derived for display. A Location may participate in multiple requirements, and one requirement may apply to multiple Locations.

Cleaning Occurrences are generated/materialized by trusted database authorities for due dates and preserve an immutable requirement/Location/role snapshot. Later Cleaning Requirement or module-role edits only affect actionable future projections and must not rewrite finalized historical occurrence meaning. Daily is Location-centric. Monthly is a canonical task-centric projection keyed by logical requirement identity, with per-date aggregate state and retained Location-level drill-down evidence.

Units, quantities, product/material relationships, storage eligibility, recurrence configuration, and duplicate constraints are server-validated where protected.

## Permissions, Versions, And Audit

Admin access requires the relevant Factory master-data permission and applicable scope.
Trusted saves derive actors server-side and use explicit grants.
Recipe/BOM versions, SOP publication/version state, material relationships, MeSTI Cleaning completion/verification evidence, and meaningful supplier/customer/location changes retain auditability.

Cleaning occurrence completion is authorized by the role snapshotted from Cleaning Settings at materialization, and verification is authorized by the corresponding verifier-role snapshot. The same employee cannot verify their own completion by default. The server derives the actual completing and verifying employee from Admin Auth through the canonical employee/Auth link.

## Workflows And Integrations

Authorized Admins maintain products/materials, compose and version recipes/BOM, manage production SOPs, configure Locations and MeSTI Cleaning Requirements, and maintain supplier and customer records.
Factory Production pins the appropriate master-data versions for planning and execution.
Factory Warehouse consumes material, product, storage, supplier, and customer references for receipts, movements, and dispatch.
Factory Production consumes active Equipment instances when recording actual equipment used; planned SOP `equipment` text remains instructional and is not execution evidence.
Factory MeSTI Cleaning consumes canonical Locations and roles while owning its daily/monthly compliance occurrence evidence.

## Compatibility And Deferred Scope

Product Recipes/BOM, Production SOP, Locations, MeSTI Cleaning setup, Suppliers, and Customers are grouped here because they are Factory reference authorities.
Historical refactor documents remain deep reference only.
Product lifecycle management, supplier portals, customer CRM, and cross-company master-data federation are deferred unless explicitly introduced.
