# Restaurant AI Agent Actions — isolated Production candidate

Prepared for explicit execution approval only. No Production database, Edge, application, main or credential mutation was performed during preparation.

The candidate is a direct child of live Production/main `c6dc4ef64054cc58addf6a647f01d685897f06c3`, using the scoped diff from verified Staging `92bcd8b851235a4eacb84f60c8358ef569cd50cc`. Shared files were reconciled with a three-way scoped patch; the changelog preserves Production history. Staging was not merged. Recruitment, Finance, Guest AI and Label Studio development is excluded. Production shell/routes, HR/RBAC pages and services, Factory pages/services/manifests, dependency lockfile and existing Gateway probe remain unchanged.

The [release manifest](2026-11-02-restaurant-agent-actions-manifest.json) owns exact paths, SHA-256 hashes, migration order, Gateway files, preservation fingerprints and the execution checklist.

## Included behavior

- Nine Restaurant capability groups and 22 fixed read resources, including read-only canonical monthly Outlet P&L, periods and separately authorized outlet comparison inputs.
- 23 separate Action grants: Asset Create/Update; Inspection and Maintenance Create/Update/Complete; scheduled Stock Check Create/Update/Submit; PO Create/Update/Submit/Supplier Confirm/Return to Draft/Cancel/Complete/Receive; manual Adjustment and Waste creation; Recipe Create/Update.
- Existing opaque Agent identity/credential, Role grants/outlet scope, canonical business bodies, idempotency, version/child-evidence locks, audit receipts, Action Requests and Activity authorities are reused.
- Inspection/Maintenance have distinct registry workflow identities and independent grants while retaining Asset Tracking as shared View/page owner. The existing unique workflow/action index is unchanged. Human Matrix presentation is unchanged; all 516 existing source permission definitions remain intact. Only 32 opt-in machine definitions and 17 hidden nonroutable machine modules are added.
- Selector workflow rows and workspace labels come from canonical capability metadata. No new Action or outlet scope is granted to any existing Production Agent automatically.

Master Inventory/Par writes, Audit-mode Stock Check actions, transfers, media uploads and independent usage forecasts are not registered. Physical completion, receiving and inspection still require genuine business evidence; an Agent instruction never supplies it implicitly.

## Dependency and deployment boundary

Production ledger is 942, with no Restaurant migrations applied. All 19 owning-function preimages match the verified migration prerequisites. Apply all eight manifest migrations once, in order; none is already applied in Production. The separate Staging ledger versions must not be copied into Production. With no concurrent changes, the expected resulting Production ledger is 950.

After SQL, deploy only the matching `factory-mesti-mcp` seven-file bundle. Existing Production v2 is the same pre-Restaurant bundle used before Staging delivery. Factory action/resource schemas and shared probe/environment files are byte-identical to Production. `external-agent-management` v1 is byte-identical and already reads expected tools dynamically; it does not need redeployment. Retain `verify_jwt=false` and the existing opaque token validation; no environment, credential, domain or alias changes are required.

The application follows the canonical single main-triggered release: fresh drift/preservation check → approved SQL/Edge dependencies → push exact explicitly approved candidate to main once → READY/exact SHA → proportional read-only Production smoke and preservation checks. No separate API application deployment or second main synchronization. On any failure, stop/report the exact state; no automatic rollback or security downgrade.

## Release-specific verification

- Isolated PostgreSQL reconstructed from current read-only Production metadata: 135 dependency tables, 63 standalone unique indexes, all PK/UNIQUE/CHECK constraints and 345 validated foreign keys. All eight migrations execute in manifest order. Three unrelated Factory MeSTI GiST exclusions remain outside the changed command paths; no migration changes them.
- Exact 1,249 Production grant rows and three scope rows survive the migration replay unchanged, including Owner 355, Admin 355, Manager 251 and existing Agent role 30 grants. The existing identity and synthetic local credential evidence also remain unchanged. No Production credential values were copied.
- Existing Factory discovery/tools/effective grants match after replay, apart from additive workflow display metadata. Existing Agents receive no Restaurant tools, resources or actions. A token with the preserved existing Agent grant shape is denied Restaurant execution.
- Production-compatible canonical Restaurant tests pass: P&L missingness, scoped registration, Asset/Inspection/Maintenance bodies and evidence denials, Waste/movement/Recipe, PO receiving and stock-posting ownership, stale versions, independent grants, scope revocation before receipt replay, exact-intent retries, concurrent duplicate serialization, audit/typed actor and Human signature compatibility.
- Bounded existing Factory Create/Update/Release/Cancel and saved-receipt replay pass on synthetic local fixtures. No live Factory record was used for mutation QA.
- `npm ci` used the unchanged Production lockfile; the candidate build passes. Focused shared Gateway/UI/RBAC/Asset/Inventory checks have 140 passes and one known pre-existing historical count-test failure. That old Outlet-navigation release test expects 119 modules/373 codes; the Production baseline already has 234/516. An independent baseline comparison proves all 104 Human modules and all 516 prior definitions unchanged. The obsolete test was not rewritten in this release.
- Staging L3 evidence reused: 42 actual MCP observations, nine committed operations and matching trusted audit receipts, no pending requests, independent grant denials, outlet isolation, concurrency/idempotency, canonical P&L equality and authenticated browser verification. Disposable Staging access was revoked/cleared/disabled, and existing grant/credential fingerprints matched afterward.

## Production preservation baseline

| Authority | Count | Fingerprint |
|---|---:|---|
| Role grants | 1,249 | `096260bcb8dadfd4b16ee44674f60915` |
| Outlet scopes | 3 | `187ac4cd820f50a1cabb52e937b548b9` |
| Agent identities | 1 | `52275e92fd53ccdc912572df99b3e5be` |
| Credentials | 1 | `916cf2b9625e27c46b0a55b1fa0c150c` |

Execution approval, fresh drift checks and post-deployment read-only smoke remain required. Preparation is GO; this document does not authorize or claim a Production release.
