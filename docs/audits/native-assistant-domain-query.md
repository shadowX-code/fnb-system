# Domain Query consolidation — 17 November 2026

## Delivery scope
110 READ / 2 ACTION remain; no new business adapters, parallel registry or SDK controller. All READ interfaces declare supported dimensions and explicitly unavailable semantics. Existing named tool callers remain supported.

- Employees: summary/count/status/type grouping, list/search/detail, legal entity/workplace/outlet/type filtering. Unique employee IDs; current canonical Employees status/type defaults. Assignment stays a separately authorized operation because its legacy policy may differ. No historical headcount, arbitrary grouping or private employee fields.
- Finished Goods: complete counts, paginated 20-row lists, exact SKU detail, current stock/low/out-of-stock filters. No company/outlet or historical/ATP/reserved-stock claims. 1,000-source safety bound and non-atomic snapshot remain.
- Restaurant: existing canonical monthly comparison operations declare period-comparison support; missing periods remain unavailable.
- Finance: canonical monthly summaries remain unchanged; comparisons require separately authorized period reads, not fabricated historical metrics.
- Crew: recorded snapshot list/count/date filters retain canonical totals and no lifecycle refresh.
- Marketing: existing scoped customer summary/list pagination and eligibility definitions remain canonical; no contact exposure, arbitrary filters or campaign mutation.

## Confirmed defects corrected
Full READ schemas serialize to about 53 KB, exceeding Text's 24 KB request limit. Large catalogues now use two compact transport envelopes (under2 KB), discovering at most8 authorized schemas before existing dispatcher execution. Both Text/Voice receive identical discovery and follow-up instructions. No new database query engine is introduced.
The single-tool Text-only low-stock formatter bypassed contextual model replies; it is no longer invoked by orchestration. Legacy formatter export remains compatibility-only.

## Policy compatibility
No configuration migration changes current flags or ACTION policy. Employees ordinary-read control atomically updates exactly two reviewed existing flags when an authorized settings editor explicitly uses it. Mixed legacy states remain visible. Future/sensitive operations do not inherit enablement. Individual overrides remain available.

## Verification and limits
Server regression suite includes completeness/page boundaries, legacy shapes, sensitive-field projection, fixed scope, denied/disconnected dispatch, mixed policy, discovery bounds and provider continuation fixtures. SQL source reference: Employees51/active41/inactive10; type counts probation24/full_time16/part_time10/contract1. Finished Goods26/low1/unknown-minimum25. Migration preserved revision24 and both policy fingerprints.
Real restricted-user scope denial remains UNAVAILABLE (no account or grants created, no SQL identity switching). Provider/audio fixtures do not establish live microphone acceptance. Stable SDK lifecycle is unchanged.
