# FeedX Codex Context

## Purpose

This is the stable project context for future Codex work.
Read it before making changes, then use `docs/README.md` to locate only the relevant domain documentation.
Do not load the legacy Master Document in full by default.

## What FeedX Is

FeedX is an F&B operations platform spanning restaurant, workforce, factory, and prototype workflows.
It favors dependable operational state, controlled lifecycles, traceability, and auditability.

## Current Workspaces

- Restaurant owns outlet finance, purchasing, inventory, assets, people administration, and related reporting.
- Crew owns employee-facing workforce, daily operations, learning, performance, reward, and localization workflows.
- Factory owns production, warehouse operations, and factory master data.
- Guest AI is a self-contained prototype workspace hosted in the FeedX repository and infrastructure with minimal business-domain coupling.

Workspace navigation is not the documentation architecture.
Canonical documentation is organized by bounded business domain, not by route, page, tab, or menu item.
The module registry and active route composition define the current application surface.

## Source Of Truth

When sources disagree, use this authority order:

1. Current implementation code.
2. Current and applied migrations and database contracts.
3. Current tests and public contracts.
4. Verified runtime behavior where evidence exists.
5. Canonical documentation under `docs/`.
6. Legacy project master and historical logs.

Current code and migrations override stale documentation.
Document verified behavior and stable boundaries, not historical plans, temporary QA state, or proposals.

## Admin And Crew Authority

Admin access and Crew access are separate security surfaces.
Admin identity is based on Supabase Auth, the canonical employee/Auth link, role assignment, permissions, and outlet scope.
Crew identity extends the employee record through Crew-specific access and opaque Crew sessions.
Crew sessions must not grant Admin authority or expose Admin authentication state.
Admin workflows must not impersonate Crew token-bound workflows.

`employees.role_id` is the canonical employee-role assignment.
`employees.auth_user_id` is the canonical employee-to-Supabase-Auth link.
Ordinary employee editing must not silently replace either authority relationship.
Permission checks in the interface are usability controls, not substitutes for database enforcement.

## Supabase And Security

Supabase is the persistent authority for production business data.
RLS is required on exposed business tables and must enforce identity, permission, ownership, and outlet scope as appropriate.
Protected multi-write or calculation-heavy lifecycles belong in trusted server authorities such as database RPCs or Edge Functions.
Clients submit intent and consume canonical results; they do not recreate protected transactions with direct table writes.

`SECURITY DEFINER` functions must:

- set a controlled `search_path`;
- validate caller, permission, and scope;
- derive actor identity server-side;
- distrust client ownership and calculated values;
- revoke `PUBLIC EXECUTE` and grant only to intended roles.

Crew mobile authorities may be callable without Supabase Auth only when they are bound to a validated opaque Crew session token.
Token-bound functions must revalidate access status, employment eligibility, expiry, and ownership on every sensitive request.
Never expose password, passcode, secret, token, or provider credential material in logs or client payloads.

## Server-Authoritative State

The server owns calculations and transitions that affect money, stock, attendance, permissions, lifecycle state, scoring, rewards, or audit evidence.
Client previews may assist users but cannot become the final authority.
Canonical mutations should return authoritative state for established read models.
Use request IDs and payload fingerprints for retry-safe lifecycle operations where the domain supports them.
A materially changed request must use a new request ID.

Do not bypass an established RPC, Edge Function, service boundary, or canonical read model with ad hoc Supabase access.
Do not introduce a second mutation path for the same protected lifecycle.

## Immutability, Versions, Snapshots, And Audit

Final business evidence should be immutable unless the domain defines a controlled reversal or superseding version.
Drafts may be editable; publication or finalization should pin the version consumed by downstream workflows.
Historical records must preserve the facts and rules that applied when they were created.
Use snapshots when later master-data edits must not rewrite historical meaning.

Audit events should record meaningful business or security actions.
Derive actor and timestamps server-side.
Prefer append-only adjustments, corrections, revisions, or ledger entries to silent overwrites.
Do not add audit noise for ordinary reads or purely cosmetic interaction.

## Shared Components And Read Models

Reuse existing FeedX controls, formatters, status vocabulary, service boundaries, and read models.
Avoid page-local alternatives for established date, money, employee, status, modal, table, or permission patterns.
Routes and compatibility aliases should resolve to one canonical owner rather than duplicate implementations.

Keep display projections separate from mutation authority.
A read model may combine domains for operational visibility, but ownership of each underlying rule remains with its canonical domain.

## Product And UI Direction

FeedX should feel quiet, precise, work-focused, efficient, and modern.
Optimize repeated workflows for scanning, comparison, and confident action.
Use compact structured layouts for operational tools.
Keep lifecycle state, scope, permission, and available actions explicit.
Use the established component vocabulary and icon library.
Meet WCAG AA for contrast, focus, keyboard interaction, and status communication.
Do not rely on color alone.

Interfaces must remain usable on desktop and mobile without overlap.
Crew mobile workflows prioritize touch ergonomics, short paths, clear confirmation, and session-safe recovery.
Do not expose developer terminology, internal identifiers, or database mechanics in user-facing copy.

## Environments And Delivery

The normal flow is local development to Staging to Production.
Treat environment identity as explicit; never infer a Supabase or Vercel target from a branch name alone.
Confirm the linked project and deployment target before environment-specific actions.
FeedX Staging Vercel deployments target only `fnb-system-staging` (`prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi`). Canonical Staging is permitted only from a clean `dev` worktree whose local `HEAD` exactly equals current `origin/dev`; the deployment SHA must be that same SHA. Run `npm run verify:staging-vercel-target` immediately before every canonical Staging deployment. It fails closed if `.vercel/project.json` is missing or resolves to any other project, the worktree is dirty, the branch is not `dev`, or local/deployment SHA differs from `origin/dev`. Use `npm run promote:staging -- <verified-deployment-url> <origin-dev-sha>` for a guarded alias promotion. Feature and Guest AI worktrees may use `npm run deploy:preview` for isolated QA only; they must never use `vercel --prod`, a production target, or a direct promotion to alter `fnb-system-staging.vercel.app`. Never implicitly run `vercel link` or create another FeedX Vercel project.
Migrations are append-only after they have reached a shared environment.
Fix an applied migration with a forward-only migration.

Staging proves migrations, trusted authorities, integrations, and representative workflows.
Production actions require explicit approval.
Do not copy Staging fixtures or data into Production.
Deploy dependent UI, schema, RPC, RLS, and Edge Function changes in a compatible order.
Do not deploy, migrate, merge, commit, or push unless the task authorizes it.

## Git Branch & Worktree Hygiene

Canonical long-lived branches are `main` for Production and `dev` for Staging/integration. Codex may create short-lived local `codex/*` or `hotfix/*` branches and worktrees for task isolation; they are not long-lived branches.

After each development task:

1. Confirm the final code is in `origin/dev`.
2. Complete required tests, `npm run build`, `git diff --check`, and any required authenticated Staging QA.
3. Check the temporary branch/worktree for cleanliness and unique or unreconciled required patches.
4. If safe, remove the temporary worktree and local branch; completed temporary branches/worktrees must not accumulate.

Before deleting a non-ancestor branch, check patch equivalence and unique work; ancestry alone is insufficient. Never automatically delete, reset, clean, stash, overwrite, or prune a dirty worktree, a branch with unique/unreconciled work, a protected Guest AI workspace, or a workspace with unclear ownership or purpose. Keep Guest AI protected workspaces isolated unless the user explicitly authorizes action.

Production deployment and merging `main` require explicit authorization. Routine cleanup must not force-push `main` or `dev`. Deliberately reconcile Production hotfixes back into `dev` after completion to prevent Production/Staging drift.

Normal lifecycle: `temporary branch/worktree → integrate origin/dev → Staging QA → cleanup temporary branch/worktree`.

## Guest AI Development & Staging Integration

Guest AI development is isolated in `/Users/deron/Dev/feedx-guest-ai` on its Guest AI worktree/branch for independent development and commits. Do not use that branch to directly overwrite, reset, replace, or force-push `dev`; `dev` is FeedX Staging's only canonical integration branch.

When a Guest AI milestone enters Staging:

1. Confirm the latest `origin/dev`.
2. Integrate only the valid Guest AI changes into current `dev`.
3. Preserve newer Crew, Admin, Factory, and other FeedX work.
4. Run relevant Guest AI and regression tests, `npm run build`, and `git diff --check`.
5. Push current `dev` to `origin/dev`.
6. Deploy and verify through canonical `fnb-system-staging`.
7. Report completion only after authenticated Staging QA passes.

Do not replace Staging directly from the Guest AI branch. Production deployment or merging `main` still requires explicit authorization. During prototype and validation, Guest AI remains a bounded FeedX module; consider an independent repository or service only after validation.

`FEEDX_CODEX_CONTEXT.md` is sourced from canonical `dev`. Every other FeedX worktree, including Guest AI, must synchronize to its latest canonical version and must not maintain divergent long-term rules.

## Codex Implementation Discipline

Read the relevant code, migrations, tests, and canonical domain docs before changing behavior.
Preserve unrelated user changes in a dirty worktree.
Keep changes scoped to the requested domain and established ownership boundaries.
Prefer existing architecture and helpers over new parallel abstractions.
Use structured APIs and parsers for structured data.

For database work, inspect existing RLS, grants, functions, indexes, and migration history first.
For lifecycle work, verify retry behavior, concurrency expectations, permissions, scope, and immutable evidence.
For cross-domain work, name the owning domain and treat other domains as consumers or projections.

Run focused tests first and broaden verification according to risk.
Use contract tests for route/module completeness and public boundaries.
Use rollback-only or approved Staging verification for database behavior when required.
Run a production build when frontend integration risk warrants it.
Always run `git diff --check` before handoff.
Report anything not tested or verified.

## Documentation Routing

Default reading order for a new task:

1. `FEEDX_CODEX_CONTEXT.md`.
2. `docs/README.md`.
3. Only the relevant canonical domain document or documents.
4. Current implementation, tests, and migrations for the affected behavior.

Read `docs/architecture/platform.md` for workspace, module, shell, route, or compatibility ownership changes.
Read `docs/architecture/trusted-authorities.md` for RLS, RPC, Edge Function, token, grant, audit, version, or snapshot changes.
Use the legacy Master Document only for targeted historical research after current sources are understood.
Use the Development Log and release/archive records as evidence of past milestones, not current architecture authority.

## Documentation Update Rules

At the end of every development task, classify documentation impact:

- Global foundation changed: update `FEEDX_CODEX_CONTEXT.md`.
- Existing domain architecture or business behavior changed: update that canonical domain document.
- New bounded domain introduced: create `docs/domains/<domain>.md` and update `docs/README.md`.
- Cosmetic UI, typography, spacing, routine bug, QA-only, or test-only change: no architecture documentation update.

A new bounded-domain document is justified only when the area has meaningful independent business rules, lifecycle, data ownership, authority, or integrations.
Prefer updating an existing domain document over creating overlapping documentation.
Do not organize canonical docs by page or navigation item.
Do not duplicate global rules in every domain document; link to the architecture authority instead.

Future Codex final reports should include one short line:

`Documentation Impact: None.`

or

`Documentation Impact: Updated docs/domains/<domain>.md.`

Use a longer documentation report only when explicitly requested.
