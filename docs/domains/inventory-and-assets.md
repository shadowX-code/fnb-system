# Inventory And Assets

## Purpose And Scope

This domain owns restaurant inventory state, controlled movements and reconciliation, recipe/usage relationships used for stock operations, and physical asset lifecycle management.

## Canonical Ownership

Current inventory and asset services, lifecycle RPCs, migrations, RLS, and tests are authoritative.
Factory raw material and finished-goods stock belong to `factory-warehouse.md`.
Factory recipes and BOM belong to `factory-master-data.md`.

## Core Entities

- Restaurant inventory items, locations, balances, and movement evidence
- Receipts, issues, transfers, adjustments, and stock checks
- Reconciliation periods, requests, and canonical stock projections
- Restaurant recipes and usage mappings that affect inventory interpretation
- Assets, assignments or location state, lifecycle events, and audit history

## Lifecycle And Business Rules

Stock changes occur through established lifecycle authorities that validate scope, quantities, state, and retry identity.
The canonical balance is server-derived from accepted evidence or the established read model; the browser must not manufacture final stock.
Corrections use explicit adjustments or controlled reversal behavior rather than rewriting posted history.

Asset creation and lifecycle transitions use the existing asset authorities.
Status, location, assignment, and retirement history must remain traceable.
Inventory and asset records are related operational concerns but retain their own entity lifecycles.

## Permissions, Snapshots, And Audit

Admin access requires inventory or asset permissions and outlet/record scope.
Protected mutation functions validate the actor server-side and expose only intended grants.
Posted movements, stock-check outcomes, lifecycle requests, and asset transitions retain immutable or append-only evidence as defined by current contracts.

## Workflows And Integrations

Admins configure items and locations, record operational movement intent, perform stock checks, reconcile differences, and manage assets.
Purchasing can supply receipt context but does not own stock posting.
Restaurant finance may consume valuation or usage projections without taking inventory write ownership.
People/RBAC supplies identity and scope.

## Compatibility And Deferred Scope

Inventory Control and Asset Tracking pages are surfaces within this domain, not separate documentation domains.
Do not merge Factory warehouse state into restaurant inventory solely because both represent stock.
Advanced costing, predictive ordering, or external warehouse integration remains deferred unless introduced by current contracts.
