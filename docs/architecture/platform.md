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

The HTML entry mounts a lightweight `App` workspace selector. `#crew` and `#crew/*` load `CrewEntry` asynchronously; all existing Admin hashes (including `#crew_dashboard`), feedback and password-recovery URLs load `AdminApp` asynchronously. Workspace selection listens to hash/history changes without replacing the existing Admin or Crew route owners. Internal route navigation preserves the mounted workspace; crossing the Admin/Mobile boundary unmounts its old session presentation and local notifications.

`AdminApp` exclusively mounts the existing `AuthProvider` and owns Admin master-data bootstrap. Visiting Crew does not mount that provider or start Admin master-data reads, even when a saved Admin session exists. Crew retains its independent token-bound session owner and guards; shared Supabase transport, renderers and localization remain single implementations rather than copied authorities. Returning to Admin restores its existing Auth session normally. `WorkspaceBoundary` provides neutral entry loading, reusing the Crew loading mark for mobile, and explicit reload after entry/render failure. It does not automatically retry a rejected lazy import.

The shared application shell owns workspace selection, navigation composition, responsive framing, and common session-aware chrome.
Domain features own their pages, business states, and workflows inside that shell.
Shared components and formatting utilities should be reused where semantics match.

Admin uses one shared UI vocabulary for layout, page headers, cards, filters, tables, feedback, permissions, and outlet-scoped controls. Crew Admin may use its shared toolbar pattern for dense operational controls while keeping page identity in the common header. Crew Mobile uses its specialized shell and shared mobile design primitives for touch-oriented flows, status, detail headers, and safe modal interactions. `CrewBottomSheet` owns selection/detail/action sheet presentation; explanatory help uses `CrewHelpSheet`, while confirmations and workflow forms use `CrewMobileModal`. Both surface primitives portal to the document body and share `useCrewOverlay` for topmost Escape handling, focus trapping/restoration, and nested scroll locking. Their shared styles own safe areas, reduced motion, and touch targets. Business content retains its validation, mutation, and close-while-saving policy; pages must not recreate overlay shells. These reusable systems standardize presentation and accessibility; they do not create a second query, mutation, or business authority.

`CrewMobileApp` composes the shell and current screen. `useCrewRoute` owns hash/history synchronization, `useCrewSession` owns the persisted opaque session envelope and guarded employee read projections, and `useCrewAttendance` owns month reads and transient clock state. Home, Login, Me, and Attendance have explicit screen owners under `src/features/crew/components/`; Me owns its local settings/profile views and Language/Logout surfaces, and Attendance owns clock dialogs. A token-keyed workspace unmounts all old employee views, local drafts, and transient dialogs on session replacement or logout. The route owner remains outside that lifetime so canonical deep links survive session restoration. No separate client business authority or global state framework is introduced.

The Crew mobile experience may use a specialized mobile shell because its identity, navigation, and interaction model differ from Admin workspaces.
That shell difference does not create a separate business authority.

Crew editable fields use the shared `--crew-type-input` token (at least 16 CSS px), independently of body/label typography, to avoid mobile focus-zoom regressions. The [Crew frontend guardrails](../testing/CREW_FRONTEND_GUARDRAILS.md) define the viewport/localization matrix and shared-interaction checks; they are test tooling, not a parallel runtime or data authority.

### Crew Startup And Route Loading

`useCrewSession` requests Attendance/context for the active session and only the additional projections needed by the current route: Home needs operations and roster; Tasks needs operations; Schedule needs roster; Growth/Performance needs both growth and performance; Reward needs reward; Me needs profile and leave summary. Learn, Cash Checkout, Leave detail, and Attendance month views keep their existing feature-owned reads. Home does not preload those secondary projections.

Root read projections are cached only in memory within the current token lifetime. Concurrent route entries reuse pending reads; successful reads are reused for 60 seconds and revalidated on a subsequent route entry. Existing same-session data stays visible during revalidation. A mutation refresh immediately reloads the active route and invalidates other route projections for their next entry, including discarding pre-mutation off-route responses. Logout/session replacement clears all projections, cache entries, and pending-request authority. Token, generation, and per-resource request identity checks prevent obsolete success or failure from affecting a newer session or refresh. This cache is a presentation optimization, never a substitute for server authorization or mutation validation.

Growth/Performance, Reward, Learn, Cash Checkout, and Leave components use route-triggered React lazy imports. Home, session bootstrap, shell, and bottom navigation remain eager. The shared `CrewRouteLoading` fallback occupies the route content while navigation remains mounted; first Home data loading also uses it rather than displaying empty business projections. Cash Checkout, Growth/Performance, Reward and Leave import their own CSS in the lazy component entry; Growth imports both its page and Performance detail styles in that order as one group. Vite preloads each async stylesheet before resolving its component import. Learn CSS remains shared/eager because its cascade and shared-renderer dependencies are outside this boundary. Tasks remains shared with the Admin task preview rather than introducing a second implementation merely to split a chunk.

## Canonical Routing

### Admin Async Feature Boundaries

The route registry owns one React lazy component identity each for Factory Workspace, Inventory Control, and Asset Tracking. Existing aliases/subroutes reuse that identity and pass their existing route props; Factory remains one workspace implementation, not a collection of independently owned route fragments. Dashboard-required services and read projections remain shared rather than copied into the delayed management pages.

`src/app/AdminRouteBoundary.jsx` owns Admin route loading and render/chunk failure presentation inside the existing shell, after the established route/permission selection. Its Suspense fallback reserves page content space while navigation stays available. A failed load offers explicit full-page reload (retaining the URL and fetching the current entry) or navigation to another route; it does not auto-reload or loop retries of React's cached rejected lazy import. Changing routes clears a failed boundary without key-remounting healthy Factory/Inventory subroute state. Crew retains its own loading boundary.

`node scripts/verifyAppBundle.mjs` builds in memory and verifies bootstrap plus each selected workspace's full static dependency closure. Both workspace closures exclude these three implementations and the Recharts/D3/Redux/Immer chart family. Crew excludes Admin Auth/shell/pages; Admin excludes the mobile root/session orchestration and GSAP. Shared Task/SOP rendering and localization have one emitted owner. This is a loading-ownership guard, not a new routing, service, or permission authority. Shared async dependencies are left to Vite/Rollup rather than forced vendor chunks. See [App bundle evidence](../testing/APP_BUNDLE_BOUNDARIES.md) for measurements and regression scope.

`src/styles/workspaceStyles.js` preserves the existing cascade order of global/shared CSS and features not yet migrated. Tokens/reset, Crew system/typography, shared sheet/modal/help/loading styles and Admin Task/SOP renderer styles remain eager. The four Crew CSS groups described above must not be re-imported by this aggregator or the Crew root: doing so would put their styles back in both workspaces' initial dependency closures. The production bundle guard checks emitted CSS ownership as well as JavaScript boundaries. Moving further styles requires separate cascade/shared-preview validation, not a global purge. Crew locale resources remain shared because Admin Task/SOP previews consume the same localization/rendering system.

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
