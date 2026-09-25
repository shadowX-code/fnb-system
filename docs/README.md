# FeedX Documentation Map

This is the canonical router for FeedX architecture and business-domain documentation.

## Task Reading

Read [`AGENTS.md`](../AGENTS.md), [`FEEDX_CODEX_CONTEXT.md`](../FEEDX_CODEX_CONTEXT.md), and this map. Then load only the relevant architecture/domain documents and current implementation evidence. Read [`FEEDX_SYSTEM_MASTER.md`](../FEEDX_SYSTEM_MASTER.md) only when ecosystem orientation, capability status, or system ownership context is needed.

Choose by durable ownership: architecture docs own cross-domain foundations; domain docs own business rules, lifecycle, data, permissions, and integrations. A cross-domain page is not automatically a new domain.

## Cross-Domain Architecture

- [`architecture/platform.md`](architecture/platform.md): workspace/module ownership, shared shell, canonical and compatibility routes, delivery/worktree procedures, and major system boundaries.
- [`architecture/trusted-authorities.md`](architecture/trusted-authorities.md): server authority, RLS, grants, Admin and Crew security boundaries, immutability, versions, snapshots, and audit.

## Canonical Domains

### Restaurant And Shared Administration

- [`domains/restaurant-finance-and-purchasing.md`](domains/restaurant-finance-and-purchasing.md): outlet finance, sales, purchases, suppliers, purchase orders, tax, imports, financial snapshots, reporting, and alerts.
- [`domains/inventory-and-assets.md`](domains/inventory-and-assets.md): restaurant inventory movements, stock state, reconciliation, recipes/usage relationships, and asset lifecycle.
- [`domains/people-identity-rbac.md`](domains/people-identity-rbac.md): employee master data, Admin identity, roles, permissions, outlet scope, and audit relationships.
- [`domains/payroll.md`](domains/payroll.md): People-owned Payroll Profiles, effective-dated compensation, public-holiday context, payable-time exceptions, Legal Entity foundation runs, and correction boundaries.

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
- [`domains/factory-product-feedback.md`](domains/factory-product-feedback.md): Factory tasting/R&D campaigns, anonymous token-bound response evidence, and analytics.

### Bounded Prototype

- [`domains/guest-ai.md`](domains/guest-ai.md): Guest AI device, protocol, voice, provider, data boundaries, worktree/Staging integration, minimal FeedX coupling, and extraction path.

## Supporting Evidence

- [`testing/`](testing/) contains focused test contracts and QA procedures; load only those relevant to the task.
- [`audits/`](audits/), [`releases/`](releases/), and [`archive/`](archive/) contain historical evidence, not current architecture authority.
- [`../FEEDX_DEVELOPMENT_LOG.md`](../FEEDX_DEVELOPMENT_LOG.md) is the milestone changelog; [`../FEEDX_PROJECT_MASTER_DOCUMENT.md`](../FEEDX_PROJECT_MASTER_DOCUMENT.md) is a legacy deep reference for targeted research only.
- [`../README.md`](../README.md), [`../PRODUCT.md`](../PRODUCT.md), and [`../design-qa.md`](../design-qa.md) provide repository, product, and design context rather than canonical domain architecture.

Historical plans, root reporting/design artifacts, and technical Markdown inside `src/features/guest-ai/` are deeper evidence; they do not replace canonical architecture or domain owners.

## Documentation Ownership Routing

`FEEDX_CODEX_CONTEXT.md` defines when Documentation Impact is required or may be `None`. Once classified, update the narrowest owner here:

- Project-wide operating, safety, QA, environment, or documentation governance: `FEEDX_CODEX_CONTEXT.md`; system ecosystem, major capability, ownership, or status: `FEEDX_SYSTEM_MASTER.md`.
- Cross-domain platform, workspace, route, delivery, or worktree contract: `architecture/platform.md`; RLS, RPC, Edge Function, token, grant, audit, version, snapshot, or trusted-authority contract: `architecture/trusted-authorities.md`.
- Existing domain lifecycle, business rule, data ownership, permission, integration, or public contract: that canonical `domains/*.md` owner.
- New genuinely independent bounded domain: create one `domains/<domain>.md` and add it to this map.
- Meaningful cross-domain, authority/security, or major delivery milestone: `FEEDX_DEVELOPMENT_LOG.md` in addition to the canonical owner; release/audit evidence belongs under `releases/`, `audits/`, or `archive/`.

`FEEDX_PROJECT_MASTER_DOCUMENT.md` is a legacy deep reference, not a daily synchronization target. `FEEDX_DEVELOPMENT_LOG.md` records meaningful milestones, not routine UI polish, minor bug fixes, or test-only work.

Route by business ownership, not presentation location. Prefer an existing owner, do not create one document per page/navigation item, and link to global governance instead of repeating it in domain docs.
