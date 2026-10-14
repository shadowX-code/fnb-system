# Creator Paste URL extraction — Staging acceptance
14 October 2026 (Asia/Kuala_Lumpur). QA L3.

## Delivered
Existing authenticated Creator Inspector → public extraction → preview/edit → explicit Creator confirmation → canonical Save. The actual Playwright/Chromium worker is deployed as a Node function in the existing fnb-system-staging project, not a proposed external service. No new account, secret, subscription, paid scraping API or AI service was provisioned.

- Endpoint: POST /api/marketing-creator-inspect; existing Supabase user JWT.
- Scope checks: canonical Creator preview/read and current member Brand authority before and after retrieval.
- Dependencies: exact playwright-core 1.55.0, @sparticuz/chromium 140.0.0 and cheerio 1.1.2. Compressed Chromium package is approximately 68.8 MB; the existing Vercel function includes its binaries.
- Browser: fresh anonymous context; no saved user browser, login, cookies, CAPTCHA solving, stealth, proxy rotation or authenticated scraping. Fixed platform/CDN hosts, pinned public IPv4 transport, GET only, private networks/credentials/WebSockets/downloads/service workers blocked, bounded redirects, 25 MB total transport budget and 45-second retrieval budget. Function maximum is 60 seconds.
- Meter: one active member lease; thirty inspections/member/day and one hundred/internal-tenant/day. Counters stay with their original tenant; no stored input URLs, HTML, browser state or inspection results.
- Share links resolve only through allowed public redirects. Security/share parameters are request-only; canonical post identity excludes them.
- Duplicate checks use the canonical resolved post URL and platform key. Verified stable platform-ID matches may suggest an active existing account; display names/handles alone never establish ownership. Staff still confirms linking.
- Creator-first and URL-first flows share existing profile creation. Actual Instagram acceptance opened New Creator with tasteeipoh and its recognized Instagram URL prefilled; no profile was automatically saved.
- Save retains existing revision/request authority. Public evidence is bounded, staff-confirmed and source/capture-labelled; metrics use existing append-only snapshots. Unknown values are omitted; zero is retained. Date-only evidence has a separate date, with no invented time.
- Authorized OAuth-derived Meta cache stays a read-only fallback. It cannot fill missing public fields, and revoked reference evidence cannot be returned after slow inspection.
- Canonical media preview supports narrowly allowed XHS/TikTok CDN thumbnails as well as existing Meta media. No originals are imported or permanently duplicated.

## Real-platform results through authenticated Staging UI
| Platform / actual URL | Actual coverage | Limits |
|---|---|---|
| Instagram https://www.instagram.com/p/DSXLNZqCJzl/?img_index=10 | Username tasteeipoh and profile URL, actual full caption in editable field, loaded 640×640 thumbnail, Likes 180 and Comments 1. Provider responses exposed 17 December 2025; exact time was available in an earlier response, while later responses omitted the time. The extractor preserves exact timestamp when returned and uses the explicit public month/day/year as date-only otherwise. | Display name, Shares and Views unavailable. No numeric author-ID match was fabricated. Latest per-run precision is visible in the UI/evidence. |
| TikTok https://vt.tiktok.com/ZSg1ckWPS/ | Resolved to https://www.tiktok.com/@ipohcarimakan/video/7213270066455006491; author handle ipohcarimakan, display name Ipohcarimakan, profile URL and public ID 7201017320880948226; actual caption and loaded 720×1280 cover; publication 22 March 2023 15:32:06 MYT; Likes 439, Comments 3, Shares 239, Views 24,100. | Public counters at capture time, not API delivery evidence or independently audited performance. |
| Facebook https://www.facebook.com/122184563510804842/posts/122171025848804842 | Real public caption preview and loaded 600-pixel thumbnail. Actual deployed Playwright rendering was used. | Public author identity, publish date and counters were not exposed. Form leaves them blank. A live-QA source-mixing defect was fixed: cached OAuth fields no longer bleed into a public observation. Caption is a provider preview and may be abbreviated. **Partial coverage, not full extraction acceptance.** |
| XHS https://www.xiaohongshu.com/explore/68523c3c0000000012004bae | Worker followed the supplied share URL only as far as the platform's redirect to /login, then stopped. UI shows an explicit platform-access restriction; Creator/manual caption/date fields and Save remain available. | **Blocked, not successful extraction.** No login, CAPTCHA, personal session or restriction bypass was attempted. Public visibility in a separate operator browser is not evidence of access from this worker. |

Observed Staging wall-clock samples: Instagram 1.9 seconds, TikTok 1.5 seconds, Facebook 7.3–7.5 seconds with browser, XHS 1.1 seconds to explicit restriction. These are observations, not response-time guarantees. Final date precision/deployment identity is recorded with the final acceptance evidence.

## Workflow and safety verification
- Focused parser, URL/network, API/Brand authorization, stale-reference revocation, Creator editing and shared profile/presentation regressions passed.
- Rollback-only SQL fixture verified anonymous denial, unknown-member denial, concurrent inspection rejection, date-only persistence, actual zero versus unavailable metrics, identical-request replay and exactly one metric snapshot.
- Fixtures were rolled back. No actual Creator/Post was saved or modified during browser acceptance. Two pre-existing archived QA creators remain; zero posts and zero new creators were observed after the cycle.
- User-visible real data was checked through the deployed, authenticated UI, not a mocked result or manually injected browser state.
- Real thumbnails were checked for completed image loading and natural dimensions.
- Desktop Light and 390 CSS-pixel mobile Light/Dark were visually checked; mobile document and scroll widths both 390, stable header/footer and accessible controls.
- Existing canonical Meta/Drive connections, CRM, publishing, Inbox and Ads execution gates were not changed.
- Security advisor: expected private-meter RLS-without-policy INFO (browser table grants revoked), and authenticated SECURITY DEFINER executable warning for the intentional permission-checked inspection RPC. No public/anonymous grant was added. See https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy and https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable.

## Cost and deployment boundaries
No paid scraping or AI API calls: no subscription introduced and no AI usage. Hosting remains the existing Vercel Staging project and its existing billing allocation, with daily request caps; there was no plan upgrade or new paid hosting resource. Runtime and outbound transfer consume that allocation. An exact incremental billed amount per inspection is not available from these tests; wall-clock time is not billed CPU time and must not be reported as an invoice or assumed zero.

No Production deployment or main merge. The endpoint explicitly rejects non-Staging environment/project/branch bindings. Two forward Staging migrations are required by a future separately approved release:
- 20261014030902_marketing_creator_public_inspection
- 20261014033913_marketing_creator_inspection_budget_scope

Rollback: use the prior UI/endpoint bundle or keep manual canonical preview; retain saved Creator/Post/history and forward-compatible columns. Do not drop records or remove public evidence to roll back presentation.

## Remaining limitations
XHS requires permitted public access or an authorized supported source; manual entry remains the honest fallback. Facebook's public surface only established partial metadata for this test. Public CDN previews can expire. No production environment adaptation, provider permission expansion, paid runtime or full-platform retrieval is claimed.
