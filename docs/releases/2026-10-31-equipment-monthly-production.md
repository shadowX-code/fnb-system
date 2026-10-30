# Cleaning Monthly Calendar Production release

Approved source: canonical Staging `3e72fe6a9fdcf268396c988783b5fda4201c16d2`.
Production baseline: `6a96e287f83002e4d70e70563f7c70a1da9403b4`.

Scope: five runtime files (shared compliance matrix, Area/Equipment Monthly consumers and two presentation projections), their focused tests and narrow domain documentation. Runtime files are identical to the approved source. Label printing/Studio, unrelated Staging work, backend services, migrations, permissions and environment configuration are excluded.

Candidate verification: 33 focused tests pass; application build passes. Existing Production schema/contracts require no migration. The read-only smoke guard's two tests pass from the Staging source; it is not added to the Production application.

Deployment procedure: recheck live/main drift, push this isolated candidate to main once, allow Vercel Git Integration, verify READY and exact main SHA. Do not issue an additional CLI/API deployment or alias promotion.

Production smoke is read-only: verify the canonical host and deployed assets, Production environment identity, RPC/schema presence and aggregate evidence continuity. Do not open Monthly/Daily operational routes or call their materializing RPCs, and do not Complete/Verify or create fixtures. Final deployment identity/results are reported in the release conversation after the post-deployment gates.
