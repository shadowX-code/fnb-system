# Platform Architecture

## Scope

This document owns cross-domain workspace, module, shell, route, and compatibility-routing principles.
Business behavior belongs in the canonical domain documents listed in `docs/README.md`.

## Workspace Ownership

FeedX currently exposes four workspaces:

- Restaurant: outlet finance, purchasing, inventory, assets, people administration, and reporting.
- Crew: workforce, operations, learning, performance/reward, and localized Crew experiences.
- Factory: production, warehouse, and factory-owned master data.
- Guest AI: a bounded prototype module with minimal coupling to FeedX business domains.

`config/modules.ts` is the canonical module and navigation registry.
Current route composition and ownership are defined by the application route configuration and route contract tests.
Documentation groupings must not create a second module or routing registry.

## Shared Shell

The shared application shell owns workspace selection, navigation composition, responsive framing, and common session-aware chrome.
Domain features own their pages, business states, and workflows inside that shell.
Shared components and formatting utilities should be reused where semantics match.

Admin uses one shared UI vocabulary for layout, page headers, cards, filters, tables, feedback, permissions, and outlet-scoped controls. Crew Admin may use its shared toolbar pattern for dense operational controls while keeping page identity in the common header. Crew Mobile uses its specialized shell and shared mobile design primitives for touch-oriented flows, status, detail headers, and safe modal interactions. These reusable systems standardize presentation and accessibility; they do not create a second query, mutation, or business authority.

The Crew mobile experience may use a specialized mobile shell because its identity, navigation, and interaction model differ from Admin workspaces.
That shell difference does not create a separate business authority.

## Canonical Routing

Every active capability has one canonical route owner and one implementation owner.
Navigation links should target canonical routes.
Permissions may hide or deny a route but must not redefine its ownership.
Route completeness contracts should remain aligned with the module registry.

Restaurant `Reports` is the canonical Admin route for Reporting preview composition. Its page owns filter state and preview controls; its standalone fixed-ratio poster components own visual rendering only. Both consume the Reporting feature service rather than querying Supabase or deriving financial results in the UI.

Compatibility routes preserve old bookmarks or prior module locations by redirecting or resolving to the canonical owner.
They must not fork page implementations, mutation behavior, or documentation ownership.
Current examples include legacy roster, Crew learning/operations, and Guest AI aliases resolved by `src/app/routeOwnership.js`.

## Major Boundaries

- The browser owns interaction and presentation, not protected business transactions.
- Feature services adapt UI intent to established database RPCs, Edge Functions, and read models.
- Supabase owns persistent business state and enforced access boundaries.
- Admin Auth and Crew token-bound sessions are distinct authority surfaces.
- Guest AI may share repository and infrastructure hosting while retaining separate service, device, and data boundaries.
- Environment and delivery identity are explicit contracts: branch names alone never select a Supabase or Vercel target. Canonical Staging and Production controls are governed by `FEEDX_CODEX_CONTEXT.md`, not duplicated in feature documentation.

Cross-workspace reporting may read several domains, but underlying lifecycle and write ownership stays with the source domain.
Moving a menu item does not transfer business ownership unless its authority, data, and contracts are deliberately migrated.

## Change Rules

Update this document when workspace boundaries, module ownership, shared shell responsibility, canonical route ownership, or compatibility strategy changes.
Update the relevant domain document for feature workflows and business rules.
