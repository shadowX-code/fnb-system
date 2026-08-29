# FeedX System Master

## Purpose And Product Vision

FeedX is an F&B operations management platform for restaurant operations, workforce execution, factory operations, and bounded prototype validation. It is designed around dependable operational state, controlled lifecycles, traceability, and clear authority rather than browser-owned business transactions.

This is the concise system map for understanding what FeedX is and how its major domains connect. It does not replace current code, migrations, contracts, verified runtime behavior, or the canonical domain documentation.

## System Architecture

FeedX has four product workspaces:

- **Restaurant** provides outlet finance, purchasing, inventory, assets, people administration, and related analytics.
- **Crew** provides the employee-facing mobile experience and Admin workforce surfaces.
- **Factory** provides production, warehouse, and factory master-data operations.
- **Guest AI** is a bounded prototype for device, voice, and provider validation.

The shared Admin shell composes workspace navigation, route visibility, and common UI. Crew Mobile uses a specialized shell and shared mobile design system, while retaining the same underlying domain authorities. The browser presents intent and read models; Supabase and trusted server authorities own persistent state, protected transitions, and enforced access boundaries.

## Environments And Delivery

`main` is the Production branch and `dev` is the canonical Staging/integration branch. Production is the `fnb-system` environment; canonical Staging is `fnb-system-staging`. Environment selection, Git hygiene, deployment verification, and approval requirements are governed by `FEEDX_CODEX_CONTEXT.md`; this document deliberately does not duplicate those operational rules.

## Product Ecosystem

| Capability | Status | System role |
|---|---|---|
| Restaurant finance, sales, purchasing, and analytics | Active | Outlet-period inputs, purchasing, financial read models, and alerts. |
| Reporting | Planned | A consolidated Admin reporting capability is not yet a canonical module. Existing analytics remain owned by their source domains. |
| Inventory and assets | Active | Restaurant stock evidence, reconciliation, recipes/usage, and asset lifecycle. |
| People, identity, and RBAC | Active | Employee master, Admin identity, roles, permissions, and outlet scope. |
| Crew workforce | Active | Crew Access, roster, attendance, leave, entitlement, and workforce context. |
| Crew operations and cash | Active | Tasks, Daily Operations, Cash Checkout, ledger, collection, and handover. |
| Crew learning and SOP | Active | Onboarding, SOP Library, versioned content, quizzes, and progress evidence. |
| Crew growth, performance, and reward | Active | Evidence-to-outcome workflows, scoring, certification, and rewards. |
| Crew localization | Active | Content variants, translation lifecycle, fallback, and frozen snapshots. |
| Factory | Active | Factory master data, production, warehouse, traceability, and reporting read models. |
| Guest AI | In Development | Isolated guest-facing device, voice, and AI-provider prototype validation. |

## Canonical Domain Ownership

| Domain | Canonical responsibility | Primary documentation |
|---|---|---|
| Restaurant finance and purchasing | Finance, purchasing, imports, periods, reports, and alerts | `docs/domains/restaurant-finance-and-purchasing.md` |
| Inventory and assets | Restaurant inventory and asset lifecycle | `docs/domains/inventory-and-assets.md` |
| People, identity, and RBAC | Employee, Admin identity, permissions, and scope | `docs/domains/people-identity-rbac.md` |
| Crew workforce | Crew Access, roster, attendance, and leave | `docs/domains/crew-workforce.md` |
| Crew operations | Tasks, Daily Operations, and cash lifecycles | `docs/domains/crew-operations.md` |
| Crew learning | Onboarding, SOP, learning, and progress | `docs/domains/crew-learning.md` |
| Crew performance and reward | Growth, performance, certification, and rewards | `docs/domains/crew-performance-and-reward.md` |
| Crew localization | Translation and localized snapshots | `docs/domains/crew-localization.md` |
| Factory master data | Factory reference data, recipes/BOM, and SOP | `docs/domains/factory-master-data.md` |
| Factory production | Planning, job orders, execution, and batches | `docs/domains/factory-production.md` |
| Factory warehouse | Raw/finished goods, movements, checks, and dispatch | `docs/domains/factory-warehouse.md` |
| Guest AI | Bounded prototype and FeedX integration limit | `docs/domains/guest-ai.md` |

## Major Data And Authority Boundaries

- **Employee and outlet scope:** People/RBAC owns employee identity, Admin access, role assignment, and outlet authority.
- **Crew Access:** Crew Workforce extends an eligible employee with a separate token-bound Crew identity; it does not grant Admin authority.
- **Operational evidence:** Sales, purchases, inventory, tasks, learning, performance, reward, and Factory state retain their own source-domain authority.
- **Read models:** Dashboards and reports may combine domains, but do not take ownership of the underlying lifecycle or mutation path.
- **Guest AI:** Prototype sessions, device/protocol data, and provider interactions remain Guest AI-owned and must not implicitly couple to operational FeedX data.

## Cross-Domain Workflows

- Employee eligibility and outlet scope feed Crew Access; Crew Access supplies safe workforce context to Crew workflows.
- Published rosters and attendance inform eligible Crew task, leave, and performance evidence without transferring source ownership.
- SOP and learning completion can create controlled qualification evidence for Growth, Performance, and Reward.
- Performance outcomes can inform Reward eligibility and calculation; finalized reward evidence does not rewrite performance history.
- Sales and purchasing inputs produce finance read models; purchasing may provide inventory context but does not own stock posting.
- Factory master data supplies Factory Production and Warehouse; Production and Warehouse preserve their own execution and stock evidence.

## Shared UI Systems

The Admin workspace uses shared layout, page-header, card, filter, table, feedback, permission, and outlet-scope patterns. Crew Mobile uses a dedicated mobile shell and shared Crew UI/design primitives for touch-oriented workflows. Reusable UI patterns establish presentation consistency only; they do not create a second business authority or replace domain contracts.

## Integrations And External Systems

- **Supabase:** persistent data, Auth, RLS, database RPCs, storage, and Edge Functions.
- **Vercel:** FeedX deployment surface, with separate Production and canonical Staging projects.
- **Guest AI providers and devices:** server-side, replaceable prototype integrations behind Guest AI contracts.

No external ERP, payroll, WMS, loyalty, payment, or Guest AI business-data integration is assumed unless current contracts explicitly introduce it.

## Documentation Map

- `AGENTS.md` explains how an agent enters the documentation system.
- `FEEDX_CODEX_CONTEXT.md` explains how to develop safely and govern documentation.
- This System Master explains what FeedX is at ecosystem level.
- `docs/architecture/*.md` explains cross-domain architecture.
- `docs/domains/*.md` explains current canonical domain knowledge.
- `FEEDX_DEVELOPMENT_LOG.md` records meaningful history.
- `FEEDX_PROJECT_MASTER_DOCUMENT.md` is a legacy historical specification and deep reference.

## Source-Of-Truth Rule

When sources disagree, current code, migrations, contracts, and verified runtime behavior prevail over documentation. Update the narrowest canonical document that describes a durable change; do not duplicate domain implementation details into this system map.
