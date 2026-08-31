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

Admin uses one shared UI vocabulary for layout, page headers, cards, filters, tables, feedback, permissions, and outlet-scoped controls. Crew Admin may use its shared toolbar pattern for dense operational controls while keeping page identity in the common header. Crew Mobile uses its specialized shell and shared mobile design primitives for touch-oriented flows, status, detail headers, and safe modal interactions. `CrewBottomSheet` owns selection/detail/action sheet presentation; explanatory help uses `CrewHelpSheet`, while confirmations and workflow forms use `CrewMobileModal`. Both surface primitives portal to the document body and share `useCrewOverlay` for topmost Escape handling, focus trapping/restoration, and nested scroll locking. Their shared styles own safe areas, reduced motion, and touch targets. Business content retains its validation, mutation, and close-while-saving policy; pages must not recreate overlay shells. These reusable systems standardize presentation and accessibility; they do not create a second query, mutation, or business authority.

`CrewMobileApp` composes the shell and current screen. `useCrewRoute` owns hash/history synchronization, `useCrewSession` owns the persisted opaque session envelope and guarded employee read projections, and `useCrewAttendance` owns month reads and transient clock state. Home, Login, Me, and Attendance have explicit screen owners under `src/features/crew/components/`; Me owns its local settings/profile views and Language/Logout surfaces, and Attendance owns clock dialogs. A token-keyed workspace unmounts all old employee views, local drafts, and transient dialogs on session replacement or logout. The route owner remains outside that lifetime so canonical deep links survive session restoration. No separate client business authority or global state framework is introduced.

The Crew mobile experience may use a specialized mobile shell because its identity, navigation, and interaction model differ from Admin workspaces.
That shell difference does not create a separate business authority.

### Crew Startup And Route Loading

`useCrewSession` requests Attendance/context for the active session and only the additional projections needed by the current route: Home needs operations and roster; Tasks needs operations; Schedule needs roster; Growth/Performance needs both growth and performance; Reward needs reward; Me needs profile and leave summary. Learn, Cash Checkout, Leave detail, and Attendance month views keep their existing feature-owned reads. Home does not preload those secondary projections.

Root read projections are cached only in memory within the current token lifetime. Concurrent route entries reuse pending reads; successful reads are reused for 60 seconds and revalidated on a subsequent route entry. Existing same-session data stays visible during revalidation. A mutation refresh immediately reloads the active route and invalidates other route projections for their next entry, including discarding pre-mutation off-route responses. Logout/session replacement clears all projections, cache entries, and pending-request authority. Token, generation, and per-resource request identity checks prevent obsolete success or failure from affecting a newer session or refresh. This cache is a presentation optimization, never a substitute for server authorization or mutation validation.

Growth/Performance, Reward, Learn, Cash Checkout, and Leave components use route-triggered React lazy imports. Home, session bootstrap, shell, and bottom navigation remain eager. The shared `CrewRouteLoading` fallback occupies the route content while navigation remains mounted; first Home data loading also uses it rather than displaying empty business projections. Feature CSS retains its established explicit import order to preserve the cascade. Tasks remains shared with the Admin task preview rather than introducing a second implementation merely to split a chunk.

## Canonical Routing

Every active capability has one canonical route owner and one implementation owner.
Navigation links should target canonical routes.
Permissions may hide or deny a route but must not redefine its ownership.
Route completeness contracts should remain aligned with the module registry.

Restaurant `Reports` is the canonical Admin route for Reporting preview composition. Its page owns filter state and preview controls; its standalone fixed-ratio poster components own visual rendering only. Both consume the Reporting feature service rather than querying Supabase or deriving financial results in the UI.

Compatibility routes preserve old bookmarks or prior module locations by redirecting or resolving to the canonical owner.
They must not fork page implementations, mutation behavior, or documentation ownership.
Current examples include legacy roster, Crew learning/operations, and Guest AI aliases resolved by `src/app/routeOwnership.js`.

Crew Mobile uses a small hash sub-route map rather than inheriting Admin route state: `#crew/home`, `learn`, `reward`, `growth`, `growth/performance`, `me`, `me/attendance`, `me/cash-checkout`, `me/leave`, `tasks`, and `schedule`. `#crew` and an invalid Crew sub-route normalize to `#crew/home`. The Crew branch is selected before Admin Auth's bootstrap presentation, so Admin copy and shell do not flash while a Crew token-bound session restores.

## Major Boundaries

- The browser owns interaction and presentation, not protected business transactions.
- Feature services adapt UI intent to established database RPCs, Edge Functions, and read models.
- Supabase owns persistent business state and enforced access boundaries.
- Admin Auth and Crew token-bound sessions are distinct authority surfaces.
- Crew client refreshes are generation- and token-guarded. Logout, passcode-session replacement, and new Crew sign-in invalidate pending employee reads and clear all employee-scoped projections before another response may be applied.
- Guest AI may share repository and infrastructure hosting while retaining separate service, device, and data boundaries.
- Environment and delivery identity are explicit contracts: branch names alone never select a Supabase or Vercel target. Canonical Staging and Production controls are governed by `FEEDX_CODEX_CONTEXT.md`, not duplicated in feature documentation.

Cross-workspace reporting may read several domains, but underlying lifecycle and write ownership stays with the source domain.
Moving a menu item does not transfer business ownership unless its authority, data, and contracts are deliberately migrated.

## Change Rules

Update this document when workspace boundaries, module ownership, shared shell responsibility, canonical route ownership, or compatibility strategy changes.
Update the relevant domain document for feature workflows and business rules.
