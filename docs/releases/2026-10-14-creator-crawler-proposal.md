# Creator crawler V1 — separate implementation and hosting proposal
14 October 2026. Proposal only: no hosted runtime, resource provisioning, paid service, new permissions or persistent provider data authorized by this document.

## Actual current coverage
Canonical dev has no Playwright extraction worker or live inspection endpoint. creatorService.preview calls marketing_creator_post_preview. Facebook/Instagram can inspect existing authorized Meta-cache evidence; XHS/TikTok return manual fallback. Staging currently has zero saved Creator posts. No crawler operating-cost measurement or four-platform acceptance exists.

Read-only public feasibility checks:
| Platform/sample | Observed | Not established |
|---|---|---|
| XHS explore/68523c3c0000000012004bae (operator supplied share link) | Public page renders without login. Author irene_ong; profile ID 563df115e4b1cf31443e8b25; title 🇲🇾隐藏在Ipoh住宅区的美食; caption and actual carousel images; displayed date 2025-07-01; visible Likes 27 and Saves 15. | No exact publication time/timezone, comments count, views, follower count, FeedX persisted extraction or ongoing automated-access authorization. Blank metrics are unavailable, not zero. Share tokens are not copied into durable identity. |
| Instagram p/DSXLNZqCJzl (prior test URL) | Public rendering exposes tasteeipoh, caption and displayed 17 December 2025 date, Likes 180 and comment count 1 at inspection. | No reliable numeric author identity established from that visible handle alone. Login prompt remains; no sign-in, cookie/session extraction or bypass. No FeedX crawler acceptance. |
| Facebook | Existing authorized Meta adapter/cache available where the exact asset is accessible. | No public post acceptance URL or saved Creator post was available for this cycle. |
| TikTok | Canonical URL parsing and manual entry exist. | No post acceptance URL or verified extraction in this cycle. |

Observed counts are a time-specific feasibility observation, not saved customer/Creator metrics or approved Brand Knowledge. Identity matching must use stable platform identity evidence and explicit confirmation where ambiguous.

## Smallest coherent implementation
1. Keep the existing authenticated Creator inspection flow and canonical Post/Account/metric authorities. Add one replaceable extraction adapter boundary; do not build a second crawler CRM or media repository.
2. Try supported authorized Meta endpoints/cache first. Otherwise use compliant public metadata, and browser rendering only where permitted; return per-field evidence and unavailable reasons.
3. Run a pinned official Playwright/Chromium worker in one isolated browser-capable container/service. Supabase Edge currently has no configured Chromium runtime. Recommend a single bounded worker rather than adding a commercial scraping API or coupling inspection to the operator's browser session.
4. Use the existing authenticated Brand scope to create an ephemeral inspection job; independently recheck member access on worker claim/result. Worker credential must be server-only, scoped to this queue. Do not give it provider tokens unless the owning authorized API adapter requires and approves that path.
5. Every job uses a fresh anonymous browser context: no personal cookies, saved sessions, login automation, private profiles, CAPTCHA solving, stealth/proxy rotation or access-wall bypass. Stop at blocked/denied responses.
6. Strictly allowlist platform post hosts and public CDN evidence; normalize URL identity separately from request-only share parameters. Revalidate redirects/DNS against private networks at every hop; restrict protocols, ports and resource types. Abort downloads/navigation outside the bounded post. Prevent SSRF and script-initiated private network requests.
7. Start with one concurrent job, one post, finite redirects and a 30-second runtime limit; cap HTML/metadata bytes and result fields. Rate limits, operator retry and explicit unsupported results prevent unbounded crawling.
8. Return verified caption, author/profile reference, thumbnail reference, actual date precision and numeric metrics with field-level source/capture time. Do not convert a date-only label into an invented exact instant. No unrelated comments or participant data.
9. Show preview before save. Preserve explicit Creator match confirmation, canonical URL/provider-ID duplicate protection and append-only metric snapshots. Existing privacy authority governs any retained third-party text/images; do not automatically copy preview results into approved Brand Knowledge.
10. Integrate erasure/restore and temporary inspection expiry before storing personal/provider data. No new automatic retention period is activated without approval.

## Acceptance and cost
Use one approved real URL per platform, plus blocked/private/redirect/duplicate fixtures. Verify identity extraction independently from display names, provenance, date precision, media availability, numeric zero versus unavailable, no network escape and no silent persistence. Perform real-platform acceptance through the FeedX endpoint, not a one-off browser inspection.

No AI API or paid scraping service is required. This cycle provisioned none and incurred no new crawler subscription. Hosting cost is **not yet quoted or measured**: it depends on the approved browser runtime's memory/CPU billing, minimum instance time, request volume and egress. Record per-job duration and bytes, enforce a monthly budget, and quote actual provider pricing before provisioning. Existing Vercel/Supabase charges are not assumed zero.

Decisions before implementation/provisioning:
- Approve the separate implementation scope and browser hosting provider/region/budget.
- Confirm permitted public retrieval and provider-data retention/erasure boundary.
- Supply actual Facebook and TikTok post URLs for acceptance; existing XHS/Instagram samples remain available.
- Decide whether crawler support is a release gate or whether manual Creator V1 may ship independently.

No Production release, external message, OAuth scope or paid resource is authorized.
