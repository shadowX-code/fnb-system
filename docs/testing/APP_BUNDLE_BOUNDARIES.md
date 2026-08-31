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

The app still has a shared Admin/Crew initial entry and global CSS. A later entry-boundary phase may address those separately; this change does not move AuthProvider, alter session ownership, change registry permissions, or modify services/RPC/RLS.

## Validation evidence

The scoped App suite passes 27 tests, including nine new lazy-route/boundary tests. The broader Crew/App, Factory, Reports and Sales/Purchase run passes 700 of 706 tests. The six failures are all in the unchanged `DutyRosterLifecycle.test.jsx`: fixed August 10 roster expectations conflict with the current-date week initialized by the page. An isolated archive of the unmodified baseline reproduces the same six failures (five tests pass). This phase neither changes that runtime nor suppresses or updates those assertions. Track that date-fixture debt separately from bundle acceptance.
