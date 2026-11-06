# Creator Inspection isolation and retention

## Acceptance

L3 security/integration verification: exact workload OIDC validation, unauthorized/expired/wrong-environment denial, no forwarding of Admin tokens, unchanged pre/post business authorization, no arbitrary browser options, SSRF/redirect/private-IP regressions, existing extraction/provenance and deadline tests. Inspect the actual worker and main Function Bundles; every main API trace must contain zero Chromium/Playwright files. Perform authenticated Staging public-profile and Facebook browser-required preview without saving business records. Verify manual/unavailable paths and separately attributed worker/gateway logs. Keep Production and billing unchanged.

## Safe Staging retention process

1. Record active canonical alias/project/SHA and current database/API compatibility. Preserve current release plus **at least three verified compatible rollback checkpoints**. Initial preservation set: `cb67bd042`, `00f8e023`, `60896446`, `4e3e28aa`. Preserve all four while their compatibility is revalidated; do not infer rollback acceptance from READY alone.
2. Inventory every retained Staging deployment with full ID/SHA, state, age, aliases, platform retention protection, rollback candidacy, review/PR links and external QA links. Inventory the worker separately. Never include Production-project deployments.
3. Recommend approximately seven days for other superseded Staging releases. This is a review threshold, not an automatic delete condition. Unknown protection, compatibility or link status means **excluded**. Keep worker current plus three verified compatible versions even if older.
4. Prepare an explicit per-ID eligibility manifest with evidence time and owner review. Obtain separate approval for exact deletion IDs, revalidate immediately before each conservative batch and stop on unexpected errors. No deletion or retention-setting change is authorized by this runbook.
5. Record actual project Functions Storage before/after any later approved cleanup. Storage is GB-month metering; past accrued usage is not erased. Main isolation reduces future growth, not existing retained bundle bytes. Review weekly and after an inspection runtime release. Do not change team-wide pause, budget, build settings or Production history.

## Growth and costs

Let `G` be measured main gateway MB, `B` worker MB, `N` retained new main deployments and `K` retained worker versions. Inspection-specific retained storage is approximately `(N*G + K*B)/1000` GB per deployed region; compare with `N*71.2/1000`. Separate worker deployment cadence is essential. Use actual Vercel meter values for billing, not local file traces. Same-team worker compute still shares the team bill and alert budget. No CPU reduction is claimed without matched workloads.
