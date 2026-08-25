# FeedX Documentation Map

This directory is the canonical router for FeedX architecture and business-domain documentation.
It minimizes task context by directing contributors to only the documents relevant to a change.

## Default Task Reading Order

1. [`FEEDX_CODEX_CONTEXT.md`](../FEEDX_CODEX_CONTEXT.md)
2. This documentation map
3. The relevant canonical domain document or documents below
4. Current implementation, tests, migrations, and verified runtime evidence

Current code and migrations override stale documentation. Do not read the full legacy Master Document by default.

## Cross-Domain Architecture

- [`architecture/platform.md`](architecture/platform.md): workspace/module ownership, shared shell, canonical routes, compatibility routes, and major system boundaries.
- [`architecture/trusted-authorities.md`](architecture/trusted-authorities.md): server authority, RLS, grants, Admin and Crew security boundaries, immutability, versions, snapshots, and audit.

Read these only when the task changes or depends on the corresponding cross-domain foundation.

## Canonical Domains

### Restaurant And Shared Administration

- [`domains/restaurant-finance-and-purchasing.md`](domains/restaurant-finance-and-purchasing.md): outlet finance, sales, purchases, suppliers, purchase orders, tax, imports, financial snapshots, reporting, and alerts.
- [`domains/inventory-and-assets.md`](domains/inventory-and-assets.md): restaurant inventory movements, stock state, reconciliation, recipes/usage relationships, and asset lifecycle.
- [`domains/people-identity-rbac.md`](domains/people-identity-rbac.md): employee master data, Admin identity, roles, permissions, outlet scope, and audit relationships.

### Crew

- [`domains/crew-workforce.md`](domains/crew-workforce.md): Crew Access, Duty Roster, Attendance, Leave, balances, entitlement, and roster-derived workforce context.
- [`domains/crew-operations.md`](domains/crew-operations.md): Tasks, Daily Operations, scheduling/assignment/completion, Cash Checkout, Floating Cash, Deposit Ledger, and Handover.
- [`domains/crew-learning.md`](domains/crew-learning.md): Onboarding journeys, SOP Library, learning content, quizzes, versions, skills, and learning-side certification evidence.
- [`domains/crew-performance-and-reward.md`](domains/crew-performance-and-reward.md): Growth, Performance, monthly evidence/scoring, Reward cycles, payout logic, and operational certification outcomes.
- [`domains/crew-localization.md`](domains/crew-localization.md): localized content, source language, translation lifecycle, fallback, provider boundary, and frozen localized snapshots.

### Factory

- [`domains/factory-production.md`](domains/factory-production.md): production planning, overview, job orders, execution, batches, and traceability.
- [`domains/factory-warehouse.md`](domains/factory-warehouse.md): finished goods, dispatch, product movements, stock checks, raw receiving, and raw inventory.
- [`domains/factory-master-data.md`](domains/factory-master-data.md): recipes/BOM, production SOP, storage/master data, suppliers, and customers owned by Factory.

### Bounded Prototype

- [`domains/guest-ai.md`](domains/guest-ai.md): Guest AI device, protocol, voice, provider, data boundaries, minimal FeedX coupling, and extraction path.

## Supporting And Historical Documentation

- [`../README.md`](../README.md): concise repository and development entrypoint.
- [`../PRODUCT.md`](../PRODUCT.md): high-level product audience, purpose, and design direction.
- [`../FEEDX_PROJECT_MASTER_DOCUMENT.md`](../FEEDX_PROJECT_MASTER_DOCUMENT.md): legacy deep reference and archive; use targeted sections only.
- [`../FEEDX_DEVELOPMENT_LOG.md`](../FEEDX_DEVELOPMENT_LOG.md): milestone changelog, not architecture authority.
- [`architecture/FACTORY_REFACTOR_PLAN.md`](architecture/FACTORY_REFACTOR_PLAN.md): historical Factory refactor plan and deep reference.
- [`testing/FACTORY_RUNTIME_ROUTE_COVERAGE.md`](testing/FACTORY_RUNTIME_ROUTE_COVERAGE.md): focused test/route evidence.
- [`audits/FACTORY_V1_STAGING_SIGNOFF.md`](audits/FACTORY_V1_STAGING_SIGNOFF.md): historical staging certification evidence.
- [`releases/README.md`](releases/README.md): production release records.
- [`archive/README.md`](archive/README.md): archived reports and readiness evidence.
- [`../design-qa.md`](../design-qa.md): design QA evidence, not architecture truth.

The root `infographic/` and `slide-deck/` directories are reporting and design artifacts. They are not canonical product architecture.
Technical Markdown inside `src/features/guest-ai/` remains a deeper Guest AI implementation reference and does not replace the canonical domain document.

## Routing Rules

- Route work by business ownership, not the page where a behavior is displayed.
- A page that combines data from several domains does not become a new domain.
- Update an existing domain document when lifecycle, business rules, permissions, data ownership, integrations, or public contracts change.
- Update the global context only for project-wide foundations.
- Create a new domain document only for a genuinely independent bounded domain, then add it to this map.
- Do not update architecture docs for cosmetic, routine bug, QA-only, or test-only changes.
