# XHS provider trial — Staging
14 October 2026, Malaysia. QA L3 due to the canonical cover URL validator change.

One approved DataXAPI live note-detail v2 execution for 68523c3c0000000012004bae succeeded at 04:48:09 UTC. HTTP 200, complete, 2,598 ms. Request req_e1fea621-98cb-4999-81f2-f1aa41a19099. CNY 0.19 deducted from CNY 0.30 trial credit; remaining 0.11. No purchase/top-up.

Observed author display name irene_ong; stable ID 563df115e4b1cf31443e8b25; profile https://www.xiaohongshu.com/user/profile/563df115e4b1cf31443e8b25. Caption title: 🇲🇾隐藏在Ipoh住宅区的美食. Full caption returned. Published 1 July 2025 12:01:16 MYT. Likes 27, comments 0, shares 3, saves 15; views unavailable. The display name is not fabricated into an XHS username. Cover uses the observed sns-i11.rednotecdn.com CDN, admitted narrowly through existing preview and confirmation validators.

The actual provider response was normalized without another network call. The server-only trial configuration permits only the original idempotent request, original note and internal tenant until 15 October 2026 11:00 MYT. No new independent request or ongoing paid extraction is enabled. Reopening the original response is the provider documented idempotency path, not a second paid lookup. Five-minute reduced in-memory cache, concurrent coalescing, at most one same-key transport retry; auth/balance/HTTP errors remain actionable and manual fallback remains available. No provider credentials or whole response in browser/business records.

Focused tests cover exact note/request identity, test/example rejection, stable author identity, real zero/missing metrics, invalid author links, trial expiry/scope, concurrency/cache, transport retry identity, no auth/balance retry, bounded response size and safe media hosts. Existing API authorization/Meta fallback and Creator form regressions are included. The XHS canonical Save, date precision, retry deduplication, one snapshot, unknown-member and concurrent inspection checks use rollback-only disposable data.

No real Creator/Post was saved by acceptance. Existing Meta/Playwright, integrations and execution controls remain unchanged. No Production deployment/main merge.

Operational boundary: ongoing lookup authorization, supplier/upstream transfer and retention arrangements remain separate decisions. Current trial is not general all-XHS acceptance or a paid subscription. Provider availability beyond this tested post is unverified. Manual fallback remains necessary for restricted/removed posts and expired trials.

Primary sources: https://dataxapi.com/en/apis/xiaohongshu/notes/detail/ ; https://dataxapi.com/en/docs/requests/ ; https://dataxapi.com/en/legal/acceptable-use/ ; https://dataxapi.com/zh/legal/privacy/ .
