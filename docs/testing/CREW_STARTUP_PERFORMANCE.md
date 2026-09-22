# Crew Startup Performance Evidence

Supporting measurements for Crew Frontend Cleanup Phase 3, not a business or architecture authority. The durable loading policy belongs in [platform architecture](../architecture/platform.md).

## Build And Request Boundary

Comparable local Vite production builds (decimal kB; gzip as reported by Vite):

| Output | Before | After |
| --- | ---: | ---: |
| Shared initial application JS | 3,822.39 kB | 3,718.28 kB |
| Initial JS gzip | 992.02 kB | 967.36 kB |
| Shared application CSS | 554.92 kB | 532.14 kB |
| CSS gzip | 84.29 kB | 81.07 kB |
| Home root service reads | 9 | 4 |

At this measurement the application still shared an initial Admin/Crew entry; this is **not** a claim that Crew had an isolated 3.7 MB bundle or that the entire application was small. The build manifest placed Growth/Performance (30.44 kB), Reward (13.54 kB), Learn (23.39 kB), Cash Checkout (28.75 kB), and Leave (10.01 kB) exclusively behind dynamic imports. The entry had no static imports of these chunks. Shared lazy-only help was 1.10 kB. Home, session/bootstrap, navigation and CSS remained eager. Subsequent [app bundle boundaries](APP_BUNDLE_BOUNDARIES.md) isolate Admin/Crew entries and move Cash, Growth/Performance, Reward and Leave CSS to their lazy owners; that document owns current bundle evidence. Tasks still shares code with Admin Preview.

Request counts are root `crewService` invocations verified by orchestration tests and previous/current source, **not** a measured total browser network count or a latency/LCP benchmark. Home uses Attendance, attendance context, operations and roster. Growth, performance, reward, leave and profile no longer run at Home startup. Feature-owned reads still run when their screens require them. Tests cover concurrent-entry deduplication, TTL revalidation, mutation invalidation, optional failure retry, StrictMode replay and token replacement/logout.

Reproduce with `npm test -- --run src/features/crew src/app` and `npm run build -- --manifest`. Inspect `dist/.vite/manifest.json`: secondary components must be dynamic entries absent from the initial static dependency closure. Build output and manifests are generated artifacts, not committed fixtures.

## Artwork

Lossless WebP conversion, unchanged dimensions and composition. Original PNG and converted WebP were decoded to raw RGBA and compared byte-for-byte: all seven match. No runtime image-processing dependency was added.

| Artwork | Dimensions | PNG bytes | WebP bytes |
| --- | --- | ---: | ---: |
| Home attendance mint | 1536 × 1024 | 1,475,965 | 845,592 |
| Me profile credential | 1774 × 887 | 982,196 | 702,046 |
| Growth performance hero | 1536 × 1024 | 1,412,237 | 810,202 |
| Performance detail hero | 1810 × 869 | 1,143,527 | 884,162 |
| Reward hero | 1568 × 1003 | 1,259,559 | 955,444 |
| Onboarding journey hero | 1692 × 930 | 994,144 | 698,294 |
| Login restaurant artwork | 1774 × 887 | 1,085,775 | 878,368 |
| **Total** | | **8,353,403** | **5,774,108** |

Replaced PNGs had no remaining runtime references and were removed; Git retains the originals. Unreferenced historical artwork that is not emitted by Vite was left alone because deleting it would not improve initial transfer. These totals describe all seven assets, not assets all downloaded by Home.

## Targeted CSS Deletion Evidence

- Home: removed unreferenced `crew-v2-shift-pill`, `attendance-card`, `location`, `clock-confirm`, `actions`, `history`, `roster-summary` and `crew-v3-shift-*` / `growth-strip` shells. Current Home clock/schedule/task components remain their owners.
- Schedule: `HomeScheduleRow` uses a nested text span and `CrewStatus`, not a direct `em`; removed retired `> em` rules and earlier grid declarations superseded by the final `.crew-v2-home .crew-home-schedule-row` three-column rule. Kept active narrow-width typography, spacing and Task rules.
- Growth: removed unused v2 growth-tabs/hero/stats/links/focus and legacy performance-list/meter/trend, v3 milestone/categories/preview/skill-group, old `crew-growth-final-*` overview and `crew-skill-row` shells. Current `crew-growth-overview`, `crew-growth-performance-*`, `crew-performance-final-*`, and active skill/path/detail classes remain.
- Mixed selector lists retain live branches. Active v2/detail styles and shared component CSS are not removed simply because their names look old. Existing CSS import order and active responsive rules remain intact.

The source contracts guard current owners and absent retired selectors. Authenticated runtime comparison should inspect Home, Growth, Performance and skill/detail surfaces at 360/390/430 CSS pixels; source-contract assertions alone are not visual QA.
