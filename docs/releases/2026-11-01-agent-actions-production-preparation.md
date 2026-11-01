# AI Integrations / Factory Agent Actions — prepared Production release

Status: GO for explicit execution approval; not deployed.

## Frozen scope and baseline

- Verified source: `0d203e42bcbf012a79c07236584a03e4bb7a8afe`.
- Live Production and remote main checked together: `3e347e31cc1b3cde10bde7004153d58eceb05a44`, READY deployment `dpl_F3qZz6x4y6jertpqppZ2a3q9MTEu`.
- Isolated branch: `codex/agent-actions-production-rc`, directly based on that live baseline.
- Only the fixed action manifest, hidden machine-action catalog, shared access-review primitives, AI Integrations UI/service, Cleaning eligibility UI, Gateway transport, required SQL chain, focused QA and owning documentation are changed. Production shell, routing and existing business services are retained.
- No Recruitment, Finance, Guest AI, Label Studio or unrelated Staging feature changes. Existing Production implementations in those domains are preserved.

## Exact database dependency manifest

Apply these forward migrations in this order only. Do not use an unrestricted pending-migration push. `20261101014601_factory_area_cleaning_monthly_bulk_actions.sql` is already applied and must not run again.

| Migration | SHA-256 |
| --- | --- |
| `20261101004834_factory_agent_operational_actions.sql` | `852d2150f3f90c0845d6679a3740c6041a24da33f07897089a3ac95f47e2b62a` |
| `20261101005629_factory_agent_action_execution_guardrails.sql` | `b7a05fb2baf665c4c609206edb78c8a4c5bea9f435dae4b8ac89a63a625cd12c` |
| `20261101010123_factory_agent_action_source_versions.sql` | `bc0ac29200b82321dd32c8c35b8ce84312bd36723a28309d4ec227a41954202f` |
| `20261101010825_factory_agent_actor_isolation.sql` | `637238dee06c42b534fec07d623a45c0d59660f8c24108d1a54fdf36ad0c3a36` |
| `20261101012251_factory_agent_human_rpc_metadata.sql` | `73a72b6d1ba50d03f2b32c2fb60177d0a784fe82f4c55152e956e7f0b1d61739` |
| `20261101013122_factory_agent_confirmation_receipts.sql` | `2b164572acc9e182e64318bb3534d914cffa6e197bad9443a9fb1d4a334ea249` |
| `20261101013712_factory_agent_action_access_projection.sql` | `fca8a2a1e4d4130a0efa447daeb7bf7220d38571ea9b75ec3f85102e17bca4b4` |
| `20261101020250_factory_agent_cleaning_actor_compatibility.sql` | `9e914d22805b28e9320b8f35c499924428c80fd63511ac248ed1461370d1debb` |
| `20261101050943_factory_agent_risk_execution_policy.sql` | `0db2d827239dd7e01c5828f1a4426f9de3f531a41f14a1da256f0fe6a57361e4` |
| `20261101051109_factory_agent_execution_context_consistency.sql` | `360720067fca4b8520d8c447545ea4ab7c4e5cc0c9bc6e2384460bd9d7aee267` |
| `20261101054331_factory_agent_cleaning_verify_preflight.sql` | `fef199a05dc8962d0e1fd03c9b24755e7c1659b97fab77f5d59c3d0767753294` |
| `20261101063324_factory_cleaning_permission_execution.sql` | `c3467030d188a67dc851d9c544a1702ee5fd2a931c12b6a4284405cd7c403ee6` |
| `20261101063722_factory_cleaning_request_projection.sql` | `44bf403836aca454d4782024013b4260a54143d44a55b902b444a4fdcedfc1b4` |
| `20261101065615_factory_agent_action_exception_queue.sql` | `bd46116d414d07deca3efb815ef43bde9813b5f4684af870d63bb15f34e554eb` |

Current ledger: **928**. Expected after these 14 migrations: **942**, absent concurrent changes. Recheck ledger and definitions immediately before execution.

## Edge and application order

1. Final read-only live/main, ledger, grant/scope/credential/identity/audit baseline and function-preimage drift checks. Stop on unexpected changes.
2. Apply only the manifest above. Verify schema-cache visibility and unchanged grants, scopes, credentials and evidence. Existing Human RPC signatures remain callable throughout the dependency chain.
3. Deploy only `factory-mesti-mcp`, with its existing `verify_jwt=false` setting, to the existing Production function. Include `index.ts`, `protocol.js`, `resources.js`, `actions.js`, `_shared/externalAgentProbe.js` and `_shared/externalAgentEnvironment.js`. All six files match deployed Staging v17 byte-for-byte. No environment variables, domains or credentials change. `external-agent-management` requires no deployment.
4. After explicit execution approval, push the exact isolated candidate to main once; allow the configured single Vercel main-triggered deployment. No separate API app deployment. Verify READY and live SHA = main, then proportional read-only authenticated smoke.
5. If any check fails, stop and report live SHA, main SHA and applied migration state; do not automatically roll back or restore older authorization bodies.

## Release-specific verification

- Production build PASS (existing chunk-size advisory only).
- 69 focused component/protocol/action tests PASS; 2 transport intent/idempotency tests PASS.
- All 27 extracted canonical Human business-function preimages match live Production byte-for-byte. The Area Monthly bulk compatibility preimage also matches (`a0105e81fa9f53ae5650482ee6565d9b`).
- All 14 migrations executed successfully, in order, in disposable local PostgreSQL using freshly captured Production column types/defaults/NOT NULL, PK/unique/check constraints, 346 Factory/Gateway/RBAC function definitions, 33 Factory validation triggers and the Production audit guard. New migration foreign keys/checks execute as written. No unrelated migration dependency was needed.
- Exact Production grant and scope rows were imported locally: **1,249 grants** and **3 role scopes**. Both remained byte-equivalent after migration. New permissions do not grant Actions to existing roles.
- Local synthetic Human and token-gated anonymous Agent fixtures pass same-actor Human Area/Equipment and Agent Area Cleaning compatibility, Complete-before-Verify, result validation, ungranted denial, replay/changed-intent rejection, receipt identity and before/after audit preservation. These are contract simulations, not physical-work attestations.
- Existing Production QA Executive role discovery and local opaque-token authorization remain compatible; its 30 existing grants remain View-only, action discovery is empty, all 26 action grants are false and mutation context is denied. No real credential was read or used.
- Final policies: 26 actions, comprising 15 autonomous, 4 conditional and 7 human-approval policies. Conditional eligibility and non-Cleaning separation-of-duties/evidence checks remain enforced.
- Reused completed Staging L3 mutation, concurrency, evidence, policy and Grok compatibility evidence. Reused authenticated UI acceptance for Action Requests and receipt-backed Activity. No broad suite or real Factory mutations repeated.

### Rehearsal limits

The disposable PostgreSQL distribution lacks pgcrypto/btree_gist extensions. Digest uses built-in SHA-256; an isolated random-byte default helper is used only for synthetic credential generation. Three unchanged requirement-range GiST exclusions and existing external FKs were not reconstructed. Production validation triggers, ordinary constraints and all newly introduced constraints are present. Historical requirement-overlap/real credential issuance behavior is unchanged and covered by prior Staging verification; this rehearsal does not claim a complete Production database clone or newly repeated Grok browser acceptance.

## Read-only Production preservation baseline

Canonical row-text/newline sorting fingerprint used below for release comparisons:

| Evidence | Count | Fingerprint |
| --- | ---: | --- |
| Role grants | 1,249 | `096260bcb8dadfd4b16ee44674f60915` |
| Role scopes | 3 | `187ac4cd820f50a1cabb52e937b548b9` |
| Machine credentials | 1 | `916cf2b9625e27c46b0a55b1fa0c150c` |
| Machine identities | 1 | `52275e92fd53ccdc912572df99b3e5be` |
| External Agent/Machine audit rows | 21 | `cace5982aa55fa6780788a1876c52cdc` |

Calibration currently has zero records, hence no legacy null-principal rows that would violate the new exactly-one-principal check.

The existing Grok QA Executive endpoint, identity and credential remain unchanged. Production has no Action grants today; enabling any Action is a later explicit Admin access decision, not part of this release. The release must not automatically add credentials, grants, scopes, approvals, work attestations or Agent execution.

Documentation Impact: updated — Trusted Authorities and Factory domain contracts now describe the verified shared operational action model; the Gateway QA guide and this exact release manifest record verification/deployment boundaries.
