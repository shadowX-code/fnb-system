# Factory Recipe read isolation — 2026-10-31

## Scope and evidence

L2 workflow reliability work. Production was inspected read-only; implementation delivery is canonical Staging only. No database migration, RLS, permission, business calculation, lifecycle, or snapshot contract changed.

Production `os.feedx.my` resolved to READY deployment `dpl_DxiKsDU6Pb59w21nbySkhJJ9cYR8`, SHA `ff8226cae3ee973e551b22759b25d696ce2e3fd3`. The existing browser displayed the reported Product Recipes 30-second initialization error. Prior commits `830a6591f`, `e697275ab`, and `ba3dc6b7c` are present: they bounded loading, isolated operational routes, and removed multiplied snapshot retries. Explicit Retry and refresh subsequently succeeded in the same authenticated Production browser.

The available 24-hour API logs contained successful Recipe headers/items and master snapshot reads, with maximum server origin times of 322ms, 568ms, 916ms for master ID snapshots, and 443ms for child snapshots. These timings do not measure browser queueing or response download/processing. Existing Recipe RLS was inspected without modification. Production contains 350 Recipe items; the loader reads these in reconciled 300/50 batches. Oversized image data was ruled out: Raw Material image fields contain zero bytes. No captured server error proves an RLS denial or database statement timeout for the observed incident.

**Verified defect:** Finished Goods still included the complete Recipe tree in its route bootstrap even though catalog navigation/master editing do not require it. The generic route-level bootstrap surface also calls a required Recipe failure a Factory initialization failure. Job Order/Overview routes already have no Recipe bootstrap dependency; the screenshot alone does not establish that every Factory route was blocked.

**Unresolved incident cause:** the original browser request stall was not captured with a browser waterfall. Subsequent successful retries and fast API logs do not prove its transport-level cause. This work removes the verified cross-feature blocking dependency and adds precise diagnostics; it must not be represented as proof that an intermittent network/client stall can never recur.

## Owning layers

- `factoryDataPlan` excludes Recipes from Finished Goods readiness and provides a permission-filtered `finished-good-recipes` support scope using the existing complete Recipe loader.
- `FactoryMasterDataProvider` declares deferred Recipe support. Finished Goods consumes the existing cancellable `useFactoryActionData` hook, keyed to the catalog snapshot so presentation rerenders do not restart it.
- Pending/failed Recipe versions/counts are marked Loading/Unavailable, rather than No Recipe or zero. Cost/margin remain unavailable; dependent detail and export wait for complete support. Catalog navigation, filters and master editing stay available. Explicit retry starts a new owner; unmount, permission change and replacement snapshots cancel the previous owner.
- Shared query helpers report safe Recipe ID/header/child/item stages to the existing deadline diagnostic. Diagnostics serialize stage names/timings only, with no URLs, IDs, payloads or authentication material.
- Required Product Recipes and production actions keep complete snapshot reconciliation, permission checks, the existing 30-second deadline, three concurrent batches per dataset, SDK transport retry behavior and reconciliation-only graph retries. No timeout increase or failure-as-empty fallback was added.

## Regression and deployed verification

Focused automated coverage includes route dependency contracts, complete 350-item reads, Recipe failure/retry, stalled Recipe support, navigation to Job Orders/Locations, request cancellation, no false-empty Recipe presentation, disabled dependent exports, parent rerenders, required production action readiness, and sanitized stage diagnostics. The final focused eight-file suite passed 68 tests, including all 29 operational-route tests and the stable-owner regression. The production build and diff whitespace check passed.

Canonical Staging authenticated browser checks:

- Product Recipes refresh and fresh-tab initialization render actual Recipe versions/costs.
- Finished Goods refresh renders catalog rows and Recipe costs normally.
- Staging-only DevTools URL blocking of Recipe table requests leaves Finished Goods available with explicit support failure and disabled dependent export.
- Job Orders and Locations remain navigable with Recipe requests blocked; Job Orders refresh works.
- Product Recipes fails visibly without showing No Product Recipes. Removing the rule and explicit Retry restores the list.
- Recipe-only 3G throttling resolves successfully while Finished Goods remains usable.
- All temporary request conditions were removed after QA. No business mutation was performed.

The real never-settling/30-second case is covered by controlled automated requests, rather than claiming that a naturally recurring Production stall was reproduced on demand. Production rollout requires separate explicit approval.
