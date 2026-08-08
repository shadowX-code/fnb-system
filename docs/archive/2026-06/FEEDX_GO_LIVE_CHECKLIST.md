# FeedX Go-Live Checklist

Date: 1 June 2026  
Purpose: Controlled staging-to-production cutover plan without copying staging test data.

## 1. Branch And Deployment Mapping

| Check | Expected | Result | Notes |
|---|---|---:|---|
| GitHub production branch | `main` | Pending | |
| GitHub staging branch | `dev` | Pending | |
| Vercel production project | `fnb-system` deploys from `main` | Pending | Confirm in Vercel dashboard. |
| Vercel staging project | `fnb-system-staging` deploys from `dev` | Pending | Confirm in Vercel dashboard. |

## 2. Environment Variables

| Check | Expected | Result | Notes |
|---|---|---:|---|
| Production `VITE_SUPABASE_URL` | Production Supabase `fnb-system` | Pending | Do not point to staging. |
| Production `VITE_SUPABASE_ANON_KEY` | Production anon key | Pending | |
| Staging `VITE_SUPABASE_URL` | Staging Supabase `fnb-system-staging` | Pending | |
| Staging `VITE_SUPABASE_ANON_KEY` | Staging anon key | Pending | |

## 3. Git Release Check

Run from a clean working tree:

```bash
git checkout dev
git pull origin dev
npm run build
git diff --check
git log main..dev --oneline
```

Gate:

- Build passes.
- Diff check passes.
- Release candidate report says READY.
- No uncommitted release docs or local environment files are pending.

## 4. Merge Code

Only after Git release check passes:

```bash
git checkout main
git pull origin main
git merge dev
npm run build
git push origin main
```

Do not merge automatically from Codex unless explicitly instructed after READY status.

## 5. Production Supabase Schema

Important: Do not copy staging data.

Post-reset status on 1 June 2026:

- Production project ref verified: `oyfobxdoyfuzsodogpgs`.
- Production reset completed with `supabase db reset --linked --yes`.
- Remote migration parity confirmed: 67 local migrations / 67 remote migrations.
- No `dev` to `main` merge has been performed yet.

Post-reset cleanup:

- The migration set temporarily created three staging/demo inventory items:
  - Sambal Sauce / `RAW-SAM-001`
  - Takeaway Cup 12oz / `PKG-CUP-012`
  - Frozen Chicken Cut / `FRZ-CHK-001`
- These were verified as staging seed data from `20260529175237_seed_inventory_master_staging.sql`, not required production defaults.
- Only those three `inventory_items` rows were deleted.
- Dependent outlet/item link and operational child rows were checked and were already zero.
- Production `inventory_items` count is now `0`.

Current approved defaults retained:

- Roles: `10`
- Permissions: `134`
- Role permissions: `288`
- Inventory UOMs: `8`
- Inventory categories: `8`
- Inventory menu categories: `8`
- Storage buckets: `2`

Gate:

- Production migration parity remains confirmed after reset.
- Staging/demo inventory rows are not present in production after cleanup.
- No staging auth users, sales, purchases, inventory, recipes, product analytics, photos, or test employees are copied.

## 6. Production Seed Rules

Allowed production defaults:

- Roles.
- Permissions.
- Required app settings.
- UOM defaults.
- Approved category defaults.

Do not seed:

- Test employees.
- Test outlets.
- Test inventory.
- Test recipes.
- Test sales.
- Test purchases.
- Test product analytics.
- Test photos.
- Staging auth users.

## 7. Supabase Auth URLs

Production Supabase Auth:

- Site URL: `https://<production-vercel-domain>`
- Redirect URLs:
  - `https://<production-vercel-domain>/*`
  - `https://<production-vercel-domain>/setup-password`
  - `https://<production-vercel-domain>/login`

UAT:

- Generate setup link.
- Open link.
- Stay on setup-password before entering password.
- Direct dashboard access redirects to setup-password.
- Complete password setup.
- Logout/login works with new password.
- Forgot password works with no Access Error.

## 8. Storage

Verify production buckets and policies:

- Employee photos if enabled.
- `inventory-item-photos` for inventory, recipe, and wastage evidence.
- `asset-photos` for asset, maintenance, and inspection evidence.

UAT:

- Upload.
- Display after refresh.
- Replace image.
- Old object cleanup where supported.

## 9. Final UAT

Run:

- `FEEDX_PRODUCTION_UAT_CHECKLIST.md`
- `FEEDX_RBAC_VERIFICATION_REPORT.md` live-role smoke tests.
- `FEEDX_INVENTORY_UAT_REPORT.md` critical inventory workflows.
- `FEEDX_PEOPLE_UAT_REPORT.md` auth/employee workflows.

## 10. Go/No-Go

Go-live requires:

- `FEEDX_RELEASE_CANDIDATE_REPORT.md` says READY.
- `FEEDX_PRODUCTION_READINESS_AUDIT.md` P0 items cleared.
- `FEEDX_PRODUCTION_UAT_CHECKLIST.md` release gates pass.
- Production Supabase link verified.
- Production Vercel env verified.
- Production auth URLs verified.

Current status: **NOT READY**
