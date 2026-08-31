# App Bundle Lazy Boundaries

## Reproducible measurement

Run `npm run build` for emitted production files and `node scripts/verifyAppBundle.mjs` for an equivalent in-memory build/module-graph assertion. The latter follows every static chunk import from HTML entry chunks; it does not mistake a renamed static vendor chunk for removed initial code. Sizes are actual minified bytes and per-file gzip, not source-file sizes. It asserts all three target implementations exist in async output and rejects the chart dependency family in the initial closure.

| Production output | Before | After |
| --- | ---: | ---: |
| Initial JS | 3,718,279 bytes | 2,055,811 bytes |
| Initial JS gzip | 967,359 bytes | 562,036 bytes |
| Initial CSS | 532,416 bytes | 532,463 bytes |
| Initial CSS gzip | 81,127 bytes | 81,133 bytes |

Initial JS decreases 44.7%; gzip decreases 41.9%. CSS remains shared; the tiny change is generated utility coverage for the new route fallback. No CSS ownership change, dependency override or manualChunks strategy is involved.

## Async ownership

| Output | Minified bytes | gzip bytes |
| --- | ---: | ---: |
| FactoryWorkspacePage | 771,834 | 171,345 |
| InventoryControlPage | 375,836 | 94,109 |
| AssetTrackingPage | 142,066 | 34,882 |
| Shared CartesianChart | 327,398 | 100,131 |
| Shared Line | 27,120 | 7,928 |
| Shared Area | 12,242 | 4,408 |
| Shared DashboardSection | 883 | 476 |

Feature rows are not total first-navigation transfer: their shared async imports may also load. Subsequent routes reuse cached shared modules. Vite introduces three feature chunks and four automatically shared chunks, not per-page Factory splitting. Recharts, D3, Redux Toolkit, Redux/react-redux/reselect and both Immer versions are absent from the initial closure. Growth retains its existing lazy renderer and now obtains chart code through the async shared graph. Reporting export imports remain unchanged.

## Regression contract

- `AdminRouteBoundary.test.jsx`: shell continuity while pending, successful props, rejected import recovery and healthy same-feature state retention across subroutes.
- `AdminLazyRoutes.test.jsx`: direct route props and one cached component identity for Factory/Inventory subroutes.
- Existing route completeness/permission/compatibility contracts remain applicable; React lazy components are valid route components, not required to be plain functions.
- Run relevant Crew/App, Factory, Asset/Inventory and Reporting tests plus the production build and `git diff --check`.
- Authenticated Staging QA must cover Dashboard, first/repeated feature navigation, Factory representative subroutes, direct refresh/back/forward, Reports and Crew. Local module-graph checks do not prove runtime authorization or business behavior.

Phase 1 retained a shared Admin/Crew initial entry. Phase 2 below replaces that JavaScript bootstrap boundary while preserving global CSS, registry permissions and services/RPC/RLS.

## Validation evidence

The scoped App suite passes 27 tests, including nine new lazy-route/boundary tests. The broader Crew/App, Factory, Reports and Sales/Purchase run passes 700 of 706 tests. The six failures are all in the unchanged `DutyRosterLifecycle.test.jsx`: fixed August 10 roster expectations conflict with the current-date week initialized by the page. An isolated archive of the unmodified baseline reproduces the same six failures (five tests pass). This phase neither changes that runtime nor suppresses or updates those assertions. Track that date-fixture debt separately from bundle acceptance.

## Phase 2 — Admin / Crew entry boundaries

Measurement follows the HTML bootstrap's static imports **plus the selected async entry and all of its static imports**. Secondary lazy routes and export actions are not counted until requested. Per-file gzip totals represent uncached compressed JS transfer, not runtime duration; they include shared chunks once within each closure. Admin/Crew rows overlap and must not be added together.

| Production closure | Minified JS bytes | gzip bytes | JS change vs Phase 1 |
| --- | ---: | ---: | ---: |
| Phase 1 shared entry baseline | 2,055,811 | 562,036 | — |
| Lightweight bootstrap only | 199,186 | 62,988 | -90.3% (not the full screen cost) |
| Bootstrap + Admin initial | 1,932,263 | 520,558 | -6.0% JS / -7.4% gzip |
| Bootstrap + Crew initial | 775,081 | 236,159 | -62.3% JS / -58.0% gzip |

At the Phase 2 measurement, initial CSS remained **532,463 bytes / 81,133 gzip**, byte-identical to Phase 1. `workspaceStyles.js` preserved the pre-existing global stylesheet order. The later CSS ownership phase below changes that loading boundary, not selectors, assets, manual vendor chunk strategy or dependency versions.

### What loads where

- Bootstrap contains React/ReactDOM, the small hash classifier, workspace boundary and shared loading mark. It contains neither authentication implementation, route registry nor localization initialization.
- Admin entry chunk: **1,278,472 bytes / 326,482 gzip**. It owns the unchanged Admin shell, AuthProvider, registry, permission filtering, master-data initialization and existing eager Admin pages. Full Crew Mobile root/Home/session orchestration and GSAP are absent. Crew-named Admin pages remain legitimate Admin ownership, not mobile leakage.
- Crew entry chunk: **124,833 bytes / 44,183 gzip**. It owns mobile root, token/session hooks, Home/Me/Attendance/Schedule and GSAP. Admin Auth, AppShell, registry and Admin page implementations are absent. Existing Growth, Reward, Learn, Cash and Leave async boundaries remain intact.
- The automatically shared chunk (currently named `useToasts`, not a claim that the toast hook itself is large) is **450,783 bytes / 128,784 gzip**. It contains actual shared dependencies/renderers: Supabase/client helpers, Crew service, i18next/react-i18next and EN/Chinese/BM resources, Task execution/preview, SOP/rich content and shared interaction primitives. These are emitted once and consumed by both entries. The existing monolithic Crew service includes Admin and mobile API methods; splitting that canonical service is outside this phase.
- Vite also emits nine small shared icon/helper chunks (individual files below 1.3 kB). Admin's initial closure uses 11 JS files; Crew's uses four. No deliberate per-component chunking or vendor override is introduced. A cached workspace transition reuses bootstrap and shared chunks; a first transition pays for the destination entry. Phase 1 Factory/Inventory/Asset and chart families remain outside both initial closures.

### Entry regression contract

- `WorkspaceEntry.test.jsx` exercises the real root selector and real Admin AuthProvider/Admin orchestration with test service responses: legacy/invalid Crew hashes, deep links, internal route lifetime, history events, Admin session restoration/login/recovery, permission denial, Admin-to-Crew unmount, pending session/master-data response isolation, and no Admin bootstrap in Crew. Existing Crew session/token and route suites continue to own actual employee/session behavior.
- `WorkspaceBoundary.test.jsx` covers neutral pending entry states, successful load, failure presentation/reload control and workspace-switch recovery.
- `useToasts.test.jsx` preserves notification defaults/expiry/dismissal and verifies cleanup on workspace replacement.
- Production graph assertions additionally reject Admin implementation in Crew, mobile root/GSAP in Admin, secondary Crew features in Crew initial, and duplicated canonical Task/SOP/localization implementations.
- Authenticated Staging checks must use the exact Git Integration deployment SHA and exercise both restored sessions, entry switching/reload, Crew secondary navigation/history, representative Admin lazy routes, Reports and canonical Task/SOP previews. Restored-session smoke is not proof of a fresh credential login.

Phase 2 local validation: App/Auth/Crew/Reports/notification suites pass **439/439** in a serial run; the four-width × three-language deterministic browser matrix passes **252/252**. Production build, graph guard and diff check pass. The broader Factory/Sales-Purchase-inclusive run passes 717/724: the six previously established Duty Roster date-fixture failures persist, and one Crew Reward-to-Performance assertion times out under concurrent load. A second concurrent focused run also exposes a transient clock-animation assertion; the unchanged Crew root suite passes 44/44 alone and the complete serial focused run passes without changing runtime or test timeouts. These timing/date-fixture limitations must not be reported as an all-green broad suite.

## CSS ownership Phase 1 — existing Crew lazy features

The same production build now emits feature CSS with Cash Checkout, Growth/Performance, Reward and Leave. The component entry owns the import; both `workspaceStyles.js` and the eager Crew root exclude it. Growth and its Performance detail styles remain ordered together in one stylesheet. No CSS declarations, selectors, responsive rules, utilities or business logic change.

| CSS output | Minified bytes | gzip bytes |
| --- | ---: | ---: |
| Initial before | 532,463 | 81,133 |
| Initial after (both workspaces) | 456,182 | 71,093 |
| Async Cash Checkout | 33,065 | 4,858 |
| Async Growth + Performance detail | 27,789 | 4,473 |
| Async Reward | 12,374 | 2,541 |
| Async Leave | 3,057 | 866 |

Initial CSS decreases **76,281 bytes (14.3%)**, gzip **10,040 bytes (12.4%)**. Loading every feature eventually transfers slightly more compressed CSS than one monolithic file because cross-file compression is lost; the benefit is deferring styles until needed, not deleting visual behavior. There are four feature stylesheets, not additional JavaScript split boundaries or vendor chunks.

Vite's existing CSS code splitting and dynamic-import preload wait for each stylesheet before resolving the feature module. Shared tokens, typography, sheet/modal/help/loading primitives, Task/SOP renderers, Learn and the other untouched global styles remain eager in their original order. Do not generalize this change to Learn or Admin/Factory utilities without a separate cascade review.

`verifyAppBundle.mjs` asserts that each target stylesheet is emitted with its feature, absent from bootstrap/Admin/Crew initial closures, and that Growth owns both CSS sources in one group. It also preserves the existing JavaScript ownership guards and verifies shared CSS stays eager. Browser regression checks exercise real lazy renderers, stylesheet requests, representative computed-style consistency on repeated navigation/refresh, and Performance detail content inside the shared sheet, across all four widths and three locales. These local fixtures do not substitute for authenticated Staging QA.

CSS Phase 1 local validation: **440/440** App/Auth/Crew/Reports/notification tests and **300/300** browser matrix checks pass; production build, module/CSS graph guard and diff check pass. The additional 48 browser cases cover four lazy CSS owners across 12 viewport/locale combinations. Cash comparisons wait for the data-ready Summary rather than comparing its distinct loading surface against the Summary layout. No runtime styling was changed to satisfy the tests.
