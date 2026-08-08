# FeedX

FeedX is an internal operational system for restaurant and factory teams. It supports daily restaurant control alongside Factory planning, production, quality, warehouse activity, stock reconciliation, and traceability.

## Workspaces

- **Restaurant**: outlet operations, inventory, purchasing, recipes, people, and reporting.
- **Factory**: production planning, Job Orders, Production, Finished Goods, Raw Materials, Receiving, Dispatch, Stock Checks, traceability, and Factory master data.

## Local Setup

```bash
npm install
npm run dev
```

Use `npm run build` before proposing a change. The Vite dev server prints its local URL when it starts.

## Supabase Migrations

Migrations are append-only. Never edit a migration that has been applied to a shared environment. Add a new forward-only migration instead.

Use the normal review flow before applying database changes:

```bash
supabase db push --dry-run
```

Apply migrations only after review and explicit approval.

## Branch and Deployment Convention

- `dev` is the active integration branch and staging candidate.
- Staging deploys from the approved `dev` commit.
- Keep local work explicit and verify `git status`, `git diff --check`, and `npm run build` before committing.

## Documentation

- [Project Master Document](system/FEEDX_PROJECT_MASTER_DOCUMENT.md): current architecture and business authority.
- [Factory V1 Staging Sign-off](docs/audits/FACTORY_V1_STAGING_SIGNOFF.md): current Factory certification summary.
- [Development Log](FEEDX_DEVELOPMENT_LOG.md): concise delivery history.
- [Release Notes](docs/releases/README.md): production release records.
- [Archived Reports](docs/archive/README.md): historical UAT and readiness evidence, not current authority.
