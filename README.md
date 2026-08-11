# FeedX

FeedX is an internal F&B operations platform for restaurant and factory teams. It covers outlet operations, inventory, purchasing, recipes, people, reporting, factory production, warehouse activity, stock reconciliation, traceability, and governance.

## Current release baseline

| Environment | Application | Source branch | Supabase project |
|---|---|---|---|
| Production | [feedx-os.vercel.app](https://feedx-os.vercel.app) | `main` | `fnb-system` (`oyfobxdoyfuzsodogpgs`) |
| Staging | [fnb-system-staging.vercel.app](https://fnb-system-staging.vercel.app) | `dev` | `fnb-system-staging` (`ujkzdaaadnvcfayuldmh`) |

Production and Staging are migrated through the current Factory and trusted-authority migration chain. Confirm the actual Vercel and Supabase target before any environment-specific action; never infer it from a branch name alone.

## Workspaces

- **Restaurant**: Sales/Purchase, Inventory Control, Suppliers, Purchase Orders, Inventory Movements, Recipes & Usage, Asset Tracking, Product Analytics, Duty Roster, Employees, Roles & Permissions, and reporting.
- **Factory**: Dashboard, Production Planning, Job Orders, Production, reports and traceability; Finished Goods and Dispatch; Raw Material receiving/inventory/movements/stock checks; Recipes/BOM and SOP; Storage Locations, Suppliers, Customers, and Factory Audit Logs.

The full canonical module registry is [`config/modules.ts`](config/modules.ts). Factory route/page completeness is protected by route-contract tests; do not create a second naming or routing system.

## Architecture rules

- Trusted server authorities own protected multi-write lifecycles. The browser submits intent, consumes canonical results, and refreshes the established read model; it must not recreate an RPC/Edge Function workflow with direct Supabase CRUD.
- Request IDs and payload fingerprints make applicable lifecycle retries idempotent. A materially changed request must use a new ID.
- Factory and Inventory ownership structures are frozen. Preserve the existing query, mutation, notification, and refresh seams; do not introduce duplicate authority.
- `employees.role_id` is the canonical employee-role assignment. `employees.auth_user_id` is the canonical employee/Auth link and must not be changed by ordinary employee editing.
- Role configuration saves only through `save_role_configuration`; Factory Recipe/BOM Draft saves only through `save_factory_product_recipe`.

Current trusted authorities include Inventory lifecycle RPCs, Asset lifecycle RPCs, `product_analytics_save_report`, Data Import batch RPCs, Sales/Purchase period snapshots, Duty Roster week lifecycle RPCs, role configuration, and Factory Recipe/BOM save.

## Local setup and verification

```bash
npm install
npm run dev
```

Run the relevant focused tests first. Before a review or promotion, run:

```bash
npm test
npm run build
git diff --check
```

The Vite build may report a large-chunk warning; it is accepted P2 performance debt unless measured production evidence justifies a change.

## Supabase migrations and deployments

Migrations are append-only. Never edit a migration applied to a shared environment; add a forward-only migration instead.

Before any database mutation, explicitly link/confirm the target project and run:

```bash
supabase db push --dry-run
```

Apply migrations or deploy Production only after explicit approval. Do not copy Staging data to Production, manually reorder/skip a migration chain, or deploy UI separately from the RPC/schema/Edge Function dependencies it requires.

## Documentation

- [Project Master Document](FEEDX_PROJECT_MASTER_DOCUMENT.md): canonical business rules, architecture, trusted authorities, current release baseline, accepted P2 debt, and development guardrails.
- [Factory V1 Staging Sign-off](docs/audits/FACTORY_V1_STAGING_SIGNOFF.md): Factory certification record.
- [Development Log](FEEDX_DEVELOPMENT_LOG.md): concise delivery history.
- [Release Notes](docs/releases/README.md): Production release records.
- [Archived Reports](docs/archive/README.md): historical UAT and readiness evidence only, not current authority.
