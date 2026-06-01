# FeedX Release Candidate Report

Date: 1 June 2026  
Candidate branch: `dev`  
Production branch: `main`  
Decision: **NOT READY**

## Executive Summary

`dev` is ahead of `main` with a large staged application release: RBAC, auth, People, Sales/Purchase, Asset Tracking, Inventory Control, Recipes, Recipe Intelligence, typography, login UI, and Supabase migration work.

The codebase builds locally and `git diff --check` passes, but this release candidate is **not ready to merge to `main`** until the P0 release blockers below are cleared.

## Branch And Working Tree Status

Local status at audit time:

- Current branch: `dev`
- Tracking: `origin/dev`
- `dev` HEAD: `34b8e6ec9e42db69a202f2adac3219c1ad2ffaa1` (`Login Page UI`)
- `origin/dev` HEAD: `34b8e6ec9e42db69a202f2adac3219c1ad2ffaa1`
- `main` HEAD: `dfa3337bbf5d443fb660b6271ad3faf132d45fa1` (`Prepare production deployment`)
- `origin/main` HEAD: `dfa3337bbf5d443fb660b6271ad3faf132d45fa1`
- Working tree is not clean:
  - Modified: `system/FEEDX_PROJECT_MASTER_DOCUMENT.md`
  - Untracked: `FEEDX_PRODUCTION_READINESS_AUDIT.md`
  - Untracked: `FEEDX_PRODUCTION_UAT_CHECKLIST.md`
  - This report: `FEEDX_RELEASE_CANDIDATE_REPORT.md`
  - Go-live checklist: `FEEDX_GO_LIVE_CHECKLIST.md`

Important: `git checkout dev` and `git pull origin dev` were not executed during this audit because the working tree contains uncommitted release documentation. The local branch is already on `dev` and currently matches `origin/dev`.

## Vercel Branch Mapping

Expected architecture:

- Production Vercel project: `fnb-system`
- Production branch: `main`
- Staging Vercel project: `fnb-system-staging`
- Staging branch: `dev`

Local verification:

- `vercel.json` only contains SPA rewrites and does not encode Vercel project or branch mapping.
- No local `.vercel/project.json` was found in the workspace.

Status: **Not locally confirmed.**

Required manual verification in Vercel before merge:

- `fnb-system` Production Deployment branch is `main`.
- `fnb-system-staging` Production/Preview deployment source is `dev` as intended by the staging project setup.
- No production project environment variables point at staging Supabase.
- No staging project environment variables point at production Supabase.

## Environment Variable Verification

Local `.env.local` keys present:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Values were not printed for security.

Required Vercel checks:

- Production Vercel `fnb-system` must point to Production Supabase `fnb-system`.
- Staging Vercel `fnb-system-staging` must point to Staging Supabase `fnb-system-staging`.
- Supabase anon keys must match the correct project.
- Supabase Auth redirect URLs must use the production Vercel domain for production.

Status: **Not locally confirmed.**

## Supabase Link Status

Local Supabase CLI link at audit time:

- Linked project ref: `ujkzdaaadnvcfayuldmh`
- Linked project name: `fnb-system-staging`

Status: **Currently linked to staging.**

Production warning:

- Do not run `supabase db push --linked` for production from this link.
- Before production migration, explicitly link to the production Supabase project and confirm the linked project ref/name.
- Do not copy staging data to production.

## Git Checks

Executed:

- `git log main..dev --oneline`
- `git log dev..main --oneline`
- `git diff --check`
- `git diff --name-status main..dev`

Results:

- `git diff --check`: **Pass**
- `dev..main`: no commits found, so `main` has no commits missing from `dev`.
- `main..dev`: `dev` has many commits ahead of `main`; see summary below.

## Commits Ahead Of Main

`dev` contains a large release train ahead of `main`. Key commit themes include:

- Login/auth UI and password flows.
- RBAC and role outlet scope fixes.
- Employee onboarding and access-state lifecycle.
- People module stabilization.
- Sales/Purchase input, import, comparison, supplier, and category persistence.
- Product Analytics and Recipe Intelligence.
- Duty Roster and Outlet Duty Roster.
- Asset Tracking, Asset Import, Maintenance, and Inspection.
- Inventory Control implementation and hardening.
- Master Inventory, Categories, UOMs, Par Levels, Stock Check, Purchase Suggestions, Purchase Orders, Movements, Wastage, Recipes, Product Mapping.
- Global typography, KPI, dark mode, modal, toast, and UI polish.

Top recent commits ahead of `main`:

```text
34b8e6e Login Page UI
902b5b5 Login Page UI
573824f Global Typography & Density Refinement
26bedcd Global Typography & Density Refinement
fb0da27 Global Typography & Density Refinement
5b45e29 Global Typography & Density Refinement
3cda91f Global Typography & Density Refinement
0b58284 Global Typography & Density Refinement
18dfcb8 Global Typography & Density Refinement
37e19b8 Global Typography & Density Refinement
65ea127 Global Typography & Density Refinement
57b6b7b Global Typography & Density Refinement
f7a8546 Global Typography & Density Refinement
95d5f90 Global Typography & Density Refinement
7f8d8a8 Global Typography & Density Refinement
5388144 Global Typography & Density Refinement
9c73dc2 Global Typography & Density Refinement
6d98418 Global Typography & Density Refinement
f5ae0de Recipe Intelligence UI optimization
4d3f473 Recipe Intelligence UI optimization
```

For the full list, run:

```bash
git log main..dev --oneline
```

## Migrations Added

`dev` adds 67 Supabase migration files relative to `main`.

Major migration domains:

- Core RBAC and company user baseline.
- Sales/Purchase persistence and RLS.
- Import batches and import integrity.
- Employee auth onboarding and access state.
- Operating Expenses and Outlet P&L.
- Duty Roster.
- Asset Tracking, Inspection, Maintenance.
- Product Analytics.
- Inventory Control master data, UOMs, stock checks, purchase orders, movements, wastage, recipes.
- Recipe naming, product-recipe mappings, mapping status.
- People employment structure and password setup completion.

Production caution:

- `20260529175237_seed_inventory_master_staging.sql` is explicitly staging/demo seed-oriented by name and content. Production seed rules must be reviewed before applying migrations to production.
- Production must seed only required system defaults: roles, permissions, required app settings, UOM defaults, and approved category defaults. Do not seed staging/test operational data.

## Modules Changed

Major modules changed or added:

- Authentication/Login/Setup Password.
- Dashboard and Overview analytics.
- Sales Input, Sales Import, Sales Comparison, Sales Channels, Tax Settings.
- Purchase Input, Purchase Import, Purchase Comparison, Suppliers, Supplier Categories.
- Operating Expenses.
- Duty Roster and Outlet Duty Roster.
- Asset Tracking.
- Data Health and Alerts/Insights.
- Inventory Control dashboard and all inventory submodules.
- Wastage.
- Recipes & Usage, Product Mapping, Recipe Intelligence.
- Employees, Job Positions, Departments, Roles & Permissions, Audit Logs.
- Shared UI: Modal, ConfirmDialog, ToastViewport, MetricCard, DataTable, PageHeader, FloatingLayer, Select/Date/MultiSelect controls.
- Shared services/utilities: Supabase client, image upload, user display, year options, access control.

## Production Risks

P0:

1. **Vercel production/staging branch mappings not locally confirmed.**
2. **Vercel production/staging Supabase environment variables not locally confirmed.**
3. **Local Supabase CLI is linked to staging, not production.**
4. **`supabase/.temp` files are tracked in `dev` and include staging project link metadata. These should not be merged to `main`.**
5. **Production Supabase migration parity not confirmed.**
6. **Production RLS/storage/auth onboarding not live-verified.**
7. **Staging/demo seed migration must be reviewed before production database push.**
8. **Working tree is not clean due release docs. Do not merge until docs are intentionally committed or stashed.**

P1:

- Vite large bundle warning remains.
- Inventory Control is monolithic and should be split after cutover.
- Some schema compatibility fallback paths remain and should be removed after production parity is proven.
- Automated test coverage is minimal/not configured.

P2:

- Some export/import report UX improvements remain future work.
- Recipe Intelligence may eventually need a separate permission key.
- More shared component extraction is recommended.

## Verification Results

| Check | Result | Notes |
|---|---:|---|
| Current branch is `dev` | Pass | `dev...origin/dev` |
| `dev` matches `origin/dev` | Pass | Same HEAD at audit time |
| `main` matches `origin/main` | Pass | Same HEAD at audit time |
| `git diff --check` | Pass | No whitespace errors |
| Local build | Pass | `npm run build` passed on 1 June 2026 during this cutover audit |
| Vercel branch mapping | Not Confirmed | Requires Vercel dashboard/CLI access |
| Vercel env mapping | Not Confirmed | Requires Vercel dashboard/CLI access |
| Production Supabase link | Not Ready | Local link is staging |
| Production migration parity | Not Confirmed | Requires production link and migration list |

## Decision

**NOT READY**

Do not merge `dev` into `main` yet.

Required before merge:

1. Commit or stash release documentation changes.
2. Remove `supabase/.temp` from version control and add/confirm ignore coverage.
3. Confirm Vercel project branch mappings.
4. Confirm Vercel Supabase environment variables for production/staging.
5. Confirm production Supabase link before any production `db push`.
6. Review staging/demo seed migration behavior before applying to production.
7. Run `npm run build` from a clean `dev` checkout after pull.
8. Run production UAT checklist.

## Merge Commands When Ready

Do not run these until the report is updated to READY.

```bash
git checkout dev
git pull origin dev
npm run build
git diff --check
git checkout main
git pull origin main
git merge dev
npm run build
git push origin main
```

Production schema command only after explicitly linking to Production Supabase:

```bash
supabase link --project-ref <production-project-ref>
supabase migration list
supabase db push --linked
```

Never run production `db push` while linked to `fnb-system-staging`.
