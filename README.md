# FeedX

FeedX is an internal F&B operations platform spanning Restaurant, Crew, Factory, and the bounded Guest AI prototype workspace. It supports outlet finance and purchasing, inventory and assets, people and access control, workforce operations and learning, factory production and warehousing, traceability, and governed AI prototyping.

## Current release baseline

| Environment | Application | Source branch | Supabase project |
|---|---|---|---|
| Production | [feedx-os.vercel.app](https://feedx-os.vercel.app) | `main` | `fnb-system` (`oyfobxdoyfuzsodogpgs`) |
| Staging | [fnb-system-staging.vercel.app](https://fnb-system-staging.vercel.app) | `dev` | `fnb-system-staging` (`ujkzdaaadnvcfayuldmh`) |

Production and Staging are migrated through the current Factory and trusted-authority migration chain. Confirm the actual Vercel and Supabase target before any environment-specific action; never infer it from a branch name alone.

## Workspaces

- **Restaurant**: outlet finance, purchasing, inventory, assets, people administration, and reporting.
- **Crew**: workforce access, roster, attendance, leave, daily operations, cash checkout, learning, performance, reward, and localized Crew experiences.
- **Factory**: production planning and execution, batch traceability, warehouse operations, and Factory master data.
- **Guest AI**: a self-contained prototype workspace for device, voice, protocol, and AI-provider validation.

The canonical module registry is [`config/modules.ts`](config/modules.ts). Read [`FEEDX_CODEX_CONTEXT.md`](FEEDX_CODEX_CONTEXT.md) for stable project-wide rules and [`docs/README.md`](docs/README.md) for task-specific architecture and domain routing.

## Local setup and verification

```bash
npm install
npm run dev
```

Run relevant focused tests first. Before a review or promotion, run the verification appropriate to the change, including:

```bash
npm test
npm run build
git diff --check
```

## Supabase migrations and deployments

Migrations are append-only. Never edit a migration applied to a shared environment; add a forward-only migration instead.

Before any database mutation, explicitly link/confirm the target project and run:

```bash
supabase db push --dry-run
```

Apply migrations or deploy Production only after explicit approval. Do not copy Staging data to Production, manually reorder/skip a migration chain, or deploy UI separately from the RPC/schema/Edge Function dependencies it requires.

## Documentation

- [`FEEDX_CODEX_CONTEXT.md`](FEEDX_CODEX_CONTEXT.md): stable project-wide engineering, authority, delivery, and documentation rules.
- [`docs/README.md`](docs/README.md): canonical documentation map and task router.
- [`PRODUCT.md`](PRODUCT.md): high-level product audience and design direction.
- [`FEEDX_PROJECT_MASTER_DOCUMENT.md`](FEEDX_PROJECT_MASTER_DOCUMENT.md): legacy deep reference/archive; not the default source of current truth.
- [`FEEDX_DEVELOPMENT_LOG.md`](FEEDX_DEVELOPMENT_LOG.md): milestone changelog, not architecture authority.
