# Factory Recipe read-isolation Production release

Approved canonical Staging source: `dc1a344e48380d9ded2d1cac774349591fa43138`.
Production baseline: `ff8226cae3ee973e551b22759b25d696ce2e3fd3`.

Only the two scoped Recipe read-isolation commits are applied to this baseline. Six runtime files, their focused regressions and narrow platform/testing documentation are included. Staging Label Management/printing and every unrelated Staging capability are excluded. Conflict resolution preserves the existing Production Raw Inventory dependency regression and omits the Staging-only Label Management scope guard. No backend, schema, RLS, permission or environment change is required.

Finished Goods catalog readiness excludes Recipes; optional Recipe support uses the existing cancellable scoped loader with a stable catalog-snapshot owner. Required Recipe details, costs and exports retain complete-data readiness. Missing support is explicit loading/error/Retry, never authoritative empty data. Required reads retain the 30-second deadline and reconciliation; timeout diagnostics add safe query-stage timing.

Candidate checks: 69 focused tests across eight files pass, Production-environment build passes, and diff whitespace/isolation checks pass. The additional test relative to Staging is an already-existing Production Raw Inventory regression, retained unchanged.

Delivery: recheck live Production and origin/main for drift, push the isolated candidate to main once, and let Vercel Git Integration create the normal deployment. Verify READY, exact main SHA, canonical host and Production backend identity. No manual CLI/API deployment, promotion, post-smoke main synchronization, migration or fixture is part of this release.

Focused browser smoke is confined to Finished Goods, Product Recipes, Job Order list and Locations: authenticated cold load/refresh/navigation and complete-support read behavior. Do not visit the materializing Production Overview or MeSTI Daily/Monthly routes or run lifecycle actions. Suppress the existing login metadata PATCH using a temporary browser-only request condition during cold-load checks; restore all browser conditions afterward. Final deployment identity and actual smoke outcomes are reported in the release conversation, without another deployment merely to record post-deployment results.

Limitation: the original intermittent browser Recipe stall's exact trigger remains unconfirmed. This release removes the verified noncritical blocking dependency and preserves explicit failure/recovery; it does not establish that network/client stalls can never recur.
