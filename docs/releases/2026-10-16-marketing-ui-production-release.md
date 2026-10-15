# Marketing UI Production release preparation — 16 October 2026

Status: prepared for separate application-only Production approval. Nothing in this preparation authorizes deployment, a main push, migrations or provider actions.

## Reconciled baseline and source scope

- Production main/live: `8746759ae513cfe5908125a238b895395a271585`.
- Existing READY Production deployment / rollback target: `dpl_8eG9U3VFaVTvaHTmgH6s1i8136NZ`.
- Vercel project: `fnb-system`, `prj_1UOKHvE6Ft4a2WXrZyZGc9LZRWLP`.
- Production Supabase: `oyfobxdoyfuzsodogpgs`; actual ledger **798**.
- Current reconciled Staging: `9f430dcb797202646350542917974b2d0081e01c`, READY deployment `dpl_2VbjcgByRjQFZjzNNFgoyfDkhDYJ`.
- UI checkpoint `5670e4b47`: that exact commit only aligns the Staging nickname migration filename. Its frontend scope is `ba2c074a31a7b0cbe290525809d5c2db825346e5` (shared filters, calendar navigation, Planner view retention) and `44e620d3e63815d170662ec74663c0907bb52d06` (concise All labels).
- Ads source: `5259985557a53e920ca5bd07a5405f9542fd3912` plus final correction `86b4651bc2204bfb50cca143421966a04f2991ff`.

The candidate containing this report descends directly from the Production baseline, rather than merging dev. Sixteen of its eighteen runtime source files match current Staging exactly. The remaining two are deliberately reconciled: CreatorsPage changes only the Brand filter label, preserving Production Creator behavior; shared CSS includes only required compact context/filter/calendar rules and shared Month Picker theme tokens. Production execution, service, transport, ownership and provider adapters are unchanged.

## Included application changes

- Content Management and Planning Insights use the canonical Month / Year, previous, Today date-picker trigger and next controls. Planner keeps the persisted Board/List/Month preference unless a task/status deep link explicitly requires List.
- Marketing Brand selectors use the concise All label while retaining authorized option values and scope derivation.
- Ads Overview prioritizes Spend, Reach, Clicks and CPC; supporting metrics, exact prior-period comparisons, daily spend gaps, provider timezone and observation times remain visible.
- Separate Results summaries retain exact Meta action identities and matching provider costs. Overlapping action counts are not summed; technical actions remain in Advanced Details.
- Campaigns defaults to six compact columns with Link clicks explicitly labeled, optional metrics, search/status/Unassigned filters, detail and Ad Set/Ad drill-down. The existing evidence-based attribution confirmation authority remains unchanged.
- Ad Accounts owns discovery and connection management; connected identities have no redundant binding actions. Reporting Ready is separate from Meta account health/management restrictions.
- Required shared dependencies: AdminCalendarNavigation, optional DatePickerField trigger/focus return, compact AdminFilterToolbar geometry and scoped shared styles. Existing DataTable mobile stack, KPI, chart, menu, date and permission contracts are reused.

## Explicit exclusions and compatibility

No migration, Edge Function, Creator API source, API route, package, lockfile, Vercel configuration, environment variable, credential, scheduler, provider or business-data mutation is part of this release. The normal Vercel application build may package its unchanged API handlers; no API behavior change or independent API deployment is requested.

The nickname-only migration `20261015175316` is not applied in Production (the current team projection still uses full name). It is not required by this frontend change and is excluded, rather than silently expanding the application release into an RPC migration. Its filename-alignment checkpoint is accounted for, not deployed as SQL. Newer Creator avatar/follower work, XHS Reader, dormant privacy implementation and unrelated Staging changes are excluded.

Production functions remain: Meta v21, worker v20, Inbox v19, privacy v18, Ads v17, Drive v17. Existing deployed function bundles are not replaced with repository copies. Publishing remains enabled in controlled account mode; Staff Reply remains normal/enabled. Ads execution is false; privacy processing/retention flags are absent/disabled. Jobs 11 and 12 remain active; Job 10 remains inactive. These are preconditions, not settings to reinstall.

Ads services, readiness, attribution helpers, reporting RPC callers, canonical tenant/Brand ownership and Meta adapters are byte-for-byte unchanged. Missing metrics remain unavailable, not zero; shared account totals and Brand-attributed campaign subtotals retain their distinct definitions and coverage. No automatic campaign assignment or arithmetic balancing is introduced. AI Copilot and Manage Ads preserve their existing authorities and execution gates.

## Focused verification

Reuse the completed Staging UI L2 evidence (69 focused tests and authenticated acceptance) and Ads L2 receipt `/private/tmp/feedx-ads-dashboard-qa-20261016.json` (46 regression tests, 23 affected rechecks, real Staging reporting, desktop/mobile Light/Dark, attribution confirmation closed without a write).

Isolated Production compatibility build passed with existing chunk-size advisory warnings. Twelve of thirteen initial focused test files passed; the sole failure was an existing Production test asserting a dropdown option had role button. The current verified Staging shared test correction was included; both affected shared test files passed all 22 checks. No runtime permission behavior was changed to satisfy the test. Diff checks and protected-source isolation passed. This is release compatibility verification, not a repeated integration audit or a claim of post-deployment acceptance.

## Exact proposed deployment sequence

1. Obtain approval naming the exact candidate SHA, baseline SHA and scope in the accompanying approval packet.
2. Immediately recheck origin/main and the live os.feedx.my deployment against the baseline above, ledger 798, existing function receipts, disabled Ads/privacy gates and scheduler states. Stop and reconcile any concurrent change before mutation.
3. Fast-forward main from the baseline to the approved candidate once, using the existing fnb-system Vercel Git Integration for one application deployment. Do not manually rebuild/deploy through another path.
4. Verify that exact deployment is READY and belongs to the existing Production project. If automatic domain assignment is paused, promote only that exact READY Production deployment to the project's existing domains when that action is included in the approval; do not add/remove domains or rebuild it.
5. Verify live SHA, then perform only focused authenticated read-only acceptance below. No Edge Function deployment, migrations or configuration installation is required.

## Focused Production acceptance after approval

- Existing Owner navigation: Content Planner, Planning Insights, Content Management calendar navigation; scope and selected-view retention. Inspect only; do not reschedule tasks or content.
- Ads Overview/Campaigns/Ad Accounts: current canonical reporting totals, reporting timezone, observed timestamps, exact action/cost labels, optional columns, detail/drill-down, and connected-account reuse visibility.
- Brand-filtered reporting must exclude Unassigned/other Brand campaign spend. Open attribution evidence/confirmation only; do not submit changes, reconnect, bind or queue synchronization.
- Existing connections and read surfaces for Publishing, Inbox, CRM, Social and Drive remain available. Reuse prior live provider receipts; no publishing, replies, OAuth, imports, AI generation, Ads changes or provider tests are needed.
- Confirm unchanged function receipts, ledger, existing gates and Job 10/11/12 states. Preserve current Production data and permissions.

## Rollback and recovery plan

There is no database or configuration rollback because neither changes. The known compatible rollback target is the existing READY Production deployment above. If the separately approved deployment has a regression and its approval explicitly permits conditional rollback, re-promote only that baseline deployment to the existing domains without rebuilding or changing providers/gates/jobs. Otherwise stop and request that exact rollback authorization.

Never reset/force-push main. An alias rollback leaves main at the candidate while live serves the prior SHA: report that divergence, pause further release actions, and prepare a separately approved forward revert/recovery. Do not overwrite a newer concurrent release with the old rollback target. No data restore, erasure or migration reversal is authorized.

## Release recommendation

GO for approval of this isolated frontend application release, conditional on unchanged preflight. NO-GO for deployment until that explicit approval. No new credentials, Meta permissions, App Review, attribution decisions or privacy activation are required by this UI scope. Nickname presentation remains the existing Production full-name projection unless separately approved later.
