# Marketing Employee names and official Creator enrichment

Production baseline: 43dda1ee168234e2d477812bd203d55746a20fba, ledger809; marketing-meta21, marketing-worker22. No Production mutation performed.

## Confirmed diagnosis

Production Planner Board/Detail/Assignee and authorized Inbox members return Employee Full Name. Seven canonical Marketing projections omit nickname. Team & Brand Access already uses canonical trimmed nickname. Existing Staging migration20261016050210 fixes the projections; Production has not applied it. Approval/lifecycle records retain actor IDs; technical content receipts do not expose an Employee Full Name label to replace. No Creator/customer/provider identity uses Employee naming rules.

Production koka.foodie account82654a35-a7bc-42d3-88a5-79fe2a5f2094 belongs to existing Creator Koh Kah, f25f50dd-ca9a-4a96-8f68-63da0738053e. No profile observation, avatar or follower count is stored. Production lacks the official Creator-profile Meta endpoint, follower schema/RPCs and worker integration. Production API uses the earlier public-profile extractor. Existing avatar schema is already installed; do not repeat its migration.

Koka is associated with Friends Corner, which lacks an eligible connected Instagram account. Canonical follower processing requires an associated same-Brand connection; no cross-Brand borrowing or artificial Creator relationship is authorized. Current Production provider access for Koka has therefore not been proven.

## Focused Staging evidence

Canonical Staging b2bd7c64d86c7c5b0b6db459019dcc9db9e81a1c, READY dpl_HmbTAJTHu1cYBSMs3QD8qNs5bJpm. Official Business Discovery through existing eligible Idamans Staging Instagram returned a real koka.foodie profile picture; rendered image natural width1080. Canonical follower worker returned31 followers, source meta_instagram_business_discovery, captured2026-10-16T16:40:02.503632Z (17October00:40MYT). Count is an observation, not a promised current count.

One disposable Staging Creator09db3b39-9dc3-4e22-8149-826bb3383dd3 was created for persistence/render/follower acceptance and shared through canonical authority with the test Brand. It was archived through canonical authority after acceptance; zero active Koka fixtures remain. No Production record was copied, changed or enriched. Existing real Creators unchanged.

One initial preview under Happiness (which has no eligible IG connection) exposed an unwanted public-HTML fallback and returned sign-in restriction; no profile evidence or Creator was saved by that preview. The shared API now returns official_profile_connection_unavailable for Instagram without eligible connection and never falls back to HTML. No retry, CAPTCHA or access restriction bypass.

Existing rollback-only nickname regression passed assigned/blocker/member/history/Inbox note names, whitespace/null fallback and foreign-Brand/anonymous denial. Actual Staging selector and revision activity show Isaac rather than Isaac Yap. Full Name fallback does not modify Employee records.

Focused candidate verification:55 provider/identity/API/Ads tests plus39 Creator UI/save/avatar tests passed; Staging focused35 tests passed; Stage and isolated Production build passed. Current Production function-body compatibility validated read-only: all seven guarded nickname patches match. No broad QA rerun.

## Prepared release scope — requires explicit Production approval

1. Recheck main/liveSHA, ledger809, Meta21, worker22 and migration checksums. Stop on drift.
2. Apply only the two pending migrations below, in listed order: ledger809→811. Preserve existing field values, employee identities, roles, Brands and provider bindings.
3. Deploy only marketing-meta and marketing-worker plus their reviewed shared dependencies. The candidate starts from captured deployed function code, preserving Messaging routing and worker22 Ads packed-checkpoint/finalization fixes that were not merged into frontend main. No new Ads behavior.
4. Fast-forward main once for existing Vercel frontend/Creator API integration. No Staging environment assumptions in Production API; no XHS Reader pilot.
5. Read-only Production nickname, Creator options, existing Publishing/Inbox/Ads compatibility. Runtime/provider settings and schedules unchanged.

Worker follower integration permits one official follower read per idle tick after Publishing claims, under eight-second provider timeout, canonical ninety-second lease, same-Brand/generation checks, daily due time and five-minute manual cooldown. The migration adopts existing eligible profiles; enabling this function version authorizes bounded official follower synchronization, not OAuth or permission expansion. If those provider reads are not approved, hold worker deployment rather than claim followers operational. No manual follower input can become official evidence.

The following provider/account action is separate: identify and explicitly approve a legitimate Friends Corner FB/IG connection before first Production Koka refresh/save/follower acceptance. Do not change Creator Brand relationships just to obtain access. Staging success does not establish Production App Advanced Access. No new permission is proven necessary by this diagnosis.

## Recovery

Rollback frontend to previous READY deployment and redeploy captured Meta21/worker22 bundles if regression. Retain additive follower columns and observations; do not drop historical data. Stop new follower reads by reverting worker integration, not disabling Job11. Nickname fixes change labels only; use guarded forward correction if needed. Existing Publishing, normal Staff Reply, Job11, CRMJob12, Drive, Social and Ads reporting remain; Ads execution/privacy/history automation remain disabled.

## Migrations and SHA256

- `20261015184643_marketing_creator_followers.sql`: `d20ddd7da7b254220ffd76cba03872a6a79a6dfb27458c717a17a58528300f62`
- `20261016050210_marketing_employee_nickname_projections.sql`: `dd5cd600ce144cb1a1dea94d4a55672344671767b280736d8225e9603b6474dc`
