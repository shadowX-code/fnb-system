# FeedX Codex Context

## Purpose

This is the stable operating context for every FeedX Codex task. Read it before making changes, then use `docs/README.md` to load only the relevant architecture and domain documents. Do not load the legacy Master Document in full by default.

## Product And Workspace Boundaries

FeedX is an F&B operations platform built around dependable operational state, controlled lifecycles, traceability, and auditability.

- Restaurant owns outlet finance, purchasing, inventory, assets, people administration, and related reporting.
- Crew owns employee-facing workforce, daily operations, learning, performance, reward, and localization workflows.
- Factory owns production, warehouse operations, and factory master data.
- Guest AI is a bounded prototype that may share FeedX hosting and infrastructure but must remain isolated from Restaurant, Crew, and Factory business data and lifecycles unless an explicit integration contract is approved.

Navigation is not the documentation architecture. Organize documentation by bounded business domain, not route, page, tab, or menu item. The module registry and active route composition define the current application surface.

## Source Of Truth

When sources disagree, use this authority order:

1. Current implementation code.
2. Current and applied migrations and database contracts.
3. Current tests and public contracts.
4. Verified runtime behavior where evidence exists.
5. Canonical documentation under `docs/`.
6. Legacy project master, development logs, releases, and archived reports.

Document verified behavior and stable boundaries, not historical plans, temporary QA state, or proposals.

## Identity, Security, And Trusted Authority

Admin and Crew are separate security surfaces. Admin identity uses Supabase Auth, the canonical employee/Auth link, role assignment, permissions, and outlet scope. Crew identity extends the employee record through Crew-specific access and opaque Crew sessions. Crew sessions must not grant Admin authority or expose Admin authentication state; Admin workflows must not impersonate Crew token-bound workflows.

`employees.role_id` is the canonical employee-role assignment and `employees.auth_user_id` is the canonical employee-to-Supabase-Auth link. Ordinary employee editing must not silently replace either relationship. Client permission checks improve usability but never replace database enforcement.

Supabase is the persistent authority for business data. Exposed business tables require RLS enforcing identity, permission, ownership, and outlet scope as appropriate. Protected multi-write or calculation-heavy lifecycles belong in trusted server authorities such as database RPCs or Edge Functions. Clients submit intent and consume canonical results; they do not recreate protected transactions with direct table writes.

`SECURITY DEFINER` functions must set a controlled `search_path`, validate caller/permission/scope, derive actor identity server-side, distrust client ownership and calculated values, revoke `PUBLIC EXECUTE`, and grant only intended roles. Crew functions callable without Supabase Auth must validate an opaque Crew session token and revalidate access status, employment eligibility, expiry, and ownership on each sensitive request. Never expose password, passcode, secret, token, or provider credential material in logs or client payloads.

## Canonical State And Evidence

The server owns calculations and transitions affecting money, stock, attendance, permissions, lifecycle state, scoring, rewards, or audit evidence. Client previews may assist users but are not final authority. Canonical mutations should return authoritative state for established read models. Use request IDs and payload fingerprints for retry-safe lifecycle operations where supported; materially changed requests require new request IDs.

Do not bypass an established RPC, Edge Function, service boundary, or canonical read model with ad hoc Supabase access. Do not introduce a second mutation path for the same protected lifecycle.

Final business evidence is immutable unless the domain defines a controlled reversal or superseding version. Drafts may be editable; publication or finalization pins the version consumed downstream. Preserve historical facts and rules through versions and snapshots when later master-data edits must not rewrite history. Audit meaningful business and security actions with server-derived actor and timestamps. Prefer append-only adjustments, corrections, revisions, or ledger entries to silent overwrites, without generating audit noise for ordinary reads or cosmetic interaction.

## Shared Product And UI Rules

Reuse established FeedX controls, formatters, status vocabulary, service boundaries, and read models. Avoid page-local alternatives for established date, money, employee, status, modal, table, permission, or lifecycle patterns. Routes and compatibility aliases resolve to one canonical owner. Read models may combine domains for visibility, but each underlying rule remains owned by its source domain.

FeedX should feel quiet, precise, work-focused, efficient, and modern. Optimize repeated workflows for scanning, comparison, and confident action. Keep lifecycle state, scope, permission, and available actions explicit. Use established components and icons; meet WCAG AA for contrast, focus, keyboard interaction, and status communication; never rely on color alone.

Interfaces must remain usable on desktop and mobile without overlap. Crew mobile prioritizes touch ergonomics, short paths, clear confirmation, and session-safe recovery. User-facing copy must not expose developer terminology, internal identifiers, or database mechanics.

## Environments, Delivery, And Git Safety

The normal path is local development to Staging to Production. Environment identity is explicit and must never be inferred from a branch name or Vercel target label alone.

- Staging Vercel: `fnb-system-staging` (`prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi`).
- Production Vercel: `fnb-system`.
- Staging Supabase: `fnb-system-staging` (`ujkzdaaadnvcfayuldmh`).
- Production Supabase: `fnb-system` (`oyfobxdoyfuzsodogpgs`).

Canonical Staging delivery is clean current `origin/dev` -> Vercel Git Integration -> verified Staging project/alias -> authenticated QA. The local `dev` HEAD, `origin/dev`, and READY deployment SHA must match. Run `npm run verify:staging-vercel-target` before canonical Staging verification. Do not replace that flow with an unnecessary manual deployment, Preview deployment, or alias promotion. Explicitly requested isolated worktree QA may use `npm run deploy:preview`, never `vercel --prod` or a promotion that alters canonical Staging. Never implicitly relink Vercel or create another FeedX project.

Before Staging database mutation or migration QA, verify the workspace is linked to the Staging Supabase ref above. Applied shared-environment migrations are append-only; corrections require a forward migration. Deploy dependent UI, schema, RPC, RLS, and Edge Function changes in compatible order. Never copy Staging fixtures or data into Production.

An explicit request to implement, fix, or change a scoped FeedX development task authorizes that repository work through its required QA level. L1 work does not deploy merely because scoped authorization exists. L2/L3 work may commit and push the scoped change to `dev` and complete canonical Staging delivery and verification when the selected level requires it, without a second action-by-action confirmation. This includes normal scoped Staging migrations and Edge Function delivery required by the implementation.

Canonical Staging is also the normal review surface for implemented UI or workflow changes when runtime or visual review is materially useful. An otherwise-L1 UI change may be delivered there for user review when seeing the real result is useful; that review does not by itself raise its QA level or authorize Production.

Action-time approval is still required for exceptional external mutations outside normal scoped Staging delivery: temporary permission changes; destructive or non-reversible business-data mutation; environment or project relinking; secrets or credentials; or materially expanded mutation scope. Stop and obtain approval if the task grows into one of these actions.

Production actions, including linking or pushing the Production database, merging `main`, and deploying Production, always require separate explicit Production authorization.

`main` is the Production branch and `dev` is the Staging/integration branch. Short-lived task branches and worktrees may isolate work. Preserve unrelated changes and never automatically reset, clean, stash, overwrite, prune, or delete a dirty worktree, protected workspace, or branch with unique or unclear work. Before cleanup, verify patch equivalence and reconcile required changes; ancestry alone is insufficient. Detailed delivery and worktree procedures live in `docs/architecture/platform.md`.

## Risk-Based Verification

Choose the lowest adequate QA level from the change's authority, blast radius, and failure cost. Escalate when findings reveal higher risk.

- **L1 Focused:** visual, copy, or local low-risk changes. Run focused verification; Staging is not required by default unless the affected behavior or evidence warrants it.
- **L2 Workflow:** normal feature, shared-UI, or workflow changes. Run relevant regression and build checks plus proportional Staging QA of the changed workflow and representative consumers.
- **L3 Canonical:** schema/migrations, RPC/RLS/Auth/permissions, trusted authorities, money/stock, canonical mutations, publication/finalization, immutable evidence, or cross-domain lifecycle changes. Run broader verification plus authenticated canonical Staging QA and representative real mutation/evidence verification where safe.
- **Production Release:** after explicit release authorization, verify the isolated release and run proportional Production smoke checks. Do not mechanically repeat unrelated Staging coverage.

At every level, verify changed contracts and representative regressions rather than the entire product mechanically. Related L1/L2 changes may be safely batched into one coherent Staging pass. Never defer L3 security or data-authority verification merely to save time or tokens. Avoid persistent QA data unless mutation verification requires it, and use approved reversible or disposable fixtures where available.

Run focused checks first, broaden according to level, run a production build when integration risk warrants it, and always run `git diff --check` before handoff. The final report must state the QA level, what was verified, and any remaining unverified risk.

## Implementation Discipline

Read relevant code, migrations, tests, and canonical domain docs before changing behavior. Keep changes scoped to the requested domain and established ownership. Prefer existing architecture, helpers, structured APIs, and parsers over parallel abstractions or ad hoc string handling.

For database work, inspect existing RLS, grants, functions, indexes, and migration history first. For lifecycle work, verify retry behavior, concurrency, permissions, scope, and immutable evidence. For cross-domain work, name the owning domain and treat other domains as consumers or projections. Use contract tests for route/module completeness and public boundaries where applicable.

## Documentation Impact

Codex independently classifies Documentation Impact for every development task and updates the narrowest canonical owner when needed. Documentation is required when a durable change affects business rules or lifecycle; canonical ownership or source of truth; schema, migrations, RPCs, Edge Functions, or read models; permission, RLS, Auth, sessions, or outlet scope; workspace/module/route or compatibility ownership; integration/deployment/environment contracts; reusable UI/system patterns; or system-level capabilities.

Documentation Impact may be `None` for visual-only polish, test-only changes, a bug fix that restores already documented behavior, or a refactor with no durable contract or behavior change. New domain documents are only for genuinely independent business rules, lifecycle, data ownership, authority, or integrations. Do not duplicate global rules in domain docs.

`docs/README.md` is the canonical file-by-file documentation router. Legacy master/log/release/archive records are historical evidence, not current architecture authority.

Every final report includes one concise line:

`Documentation Impact: None - <short reason>.`

or

`Documentation Impact: Updated <doc path>.`
