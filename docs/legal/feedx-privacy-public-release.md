# FeedX Privacy Policy limited public release candidate

Prepared 11 October 2026, Asia/Kuala_Lumpur. **Approved and publicly released on 11 October 2026.** Operator: The Y Advisory Sdn Bhd.

## Exact policy artifact

- Version 1.0; prepared 11 October 2026; effective upon first public publication (not retroactively effective while this is an unpublished candidate).
- File: `public/privacy.html`; complete English and Bahasa Malaysia, 11 sections each.
- SHA-256: `4fd83b4ada9cee8766ff9a93e5c9fd2be07e4cf0729047adb2d4149136b495cc`.
- Reviewed Staging version 3 and saved source matched byte-for-byte: SHA-256 `db47c98545bc353c25fd37f930aba0340745609777e94ef8d6f754bcaff3ac72`.
- Explicit candidate differences: version/effective-date labels; remove review-only banner and noindex/nofollow; add one matching paragraph in each language qualifying Marketing/AI/recovery controls as currently Staging-verified, dependent on actual environment deployment. All reviewed policy section text otherwise remains unchanged. No claims of appointed DPO, completed registration, universal retention, automatic purging, zero AI retention, completed transfer compliance or deletion of independent Meta originals.

## Isolation and deployment boundary

Live Production and fetched `origin/main` both identify `aa9752b59cc35615755affe76736d079a4ff0d2a`; Vercel deployment `dpl_4QjpEgLWKKmKZGUx5QuRw2N1CCx5`. Candidate branch `codex/privacy-public-release` starts exactly there, not from Staging/dev. Runtime changes are only the static policy, `middleware.js` and `vercel.json`. Test and legal-review/decision files add no runtime authority. No application components, application entry, dependencies, build settings, migrations, database, functions, secrets or Meta controls are changed.

The public rewrite matches only host `feedx.my` and exact `/privacy` or `/privacy/`, before filesystem/SPA fallback. `/privacy.html` canonicalizes on the public host. Other hosts keep the previous SPA handling of `/privacy` and `/privacy.html`; unrelated public paths retain their existing root redirect. `www.feedx.my` already redirects to the apex. No domain/DNS/project reassignment is proposed.

**Infrastructure limit:** the existing `fnb-system` Vercel project serves feedx.my, OS, Crew and Feedback together. A normal governed `main` release rebuilds that shared deployment; source isolation excludes broader application changes but is not a physically separate page deployment. Do not characterize it as an independently deployed website. If approval requires that no shared application deployment occurs at all, stop: this candidate must not be pushed to main. A separately approved hostname-only delivery arrangement would then be a material architecture/deployment decision; no new project, proxy or alias reassignment is authorized here.

## Material legal and operational risks

- DPO applicability remains likely on the recurring/systematic-monitoring test; entity/activity assessment, appointment and notification are unresolved. No DPO is appointed. Public notice is not a substitute. Controller registration is a separate actual-activity/classification decision, not assumed completed or exempt.
- Category-specific retention remains a proposal. No automatic purges activated; statutory and operational record triggers must be approved separately.
- Actual processors are disclosed, but executed arrangements, account-specific retention controls, international transfer basis/safeguards and provider deletion follow-up remain unconfirmed. Disclosure is not contractual/legal completion.
- Manual/offsite exports, named recovery/key custodians, monitoring of the supplied privacy inbox and request/breach handling ownership require operator confirmation. Verified Staging erasure infrastructure is accepted/closed and is not reopened by this release.

These remain in `feedx-privacy-operations.md`, `feedx-retention-proposal.md` and `feedx-privacy-review.md`. Public policy does not certify full compliance or authorize new processing. Legal/operator should decide whether these risks permit notice publication; no filings or appointments are part of this scope.

## Focused preparation verification

L1 static/copy and routing preparation, with a Production Release gate still required. Nine policy/hostname checks pass: bilingual completeness, contact and anchors, no scripts/forms/iframes/auth, exact public route, non-public SPA preservation, explicit Staging/legal limits. Production baseline build passes (existing large-chunk advisory). Diff isolation and whitespace checks pass. The source policy is copied unchanged into build output.

Current unauthenticated HTTPS: feedx.my root HTTP 200, privacy HTTP 308 to `/`, HSTS present. Verified Vercel ownership and domain assignment point to the existing Production project. Final policy HTTP 200/crawlability cannot be claimed until an approved release actually reaches the target. No public preview, main push, Production deployment or Meta action was performed.

## Approval and eventual verification

Before any release, obtain explicit approval of this exact version/hash, effective-on-publication wording, legal risks and shared-project deployment boundary. Recheck main/live SHA for drift. If the shared-project release is expressly approved, follow existing governed Git delivery once, limited to this candidate; do not combine it with any Staging feature or an additional CLI deployment.

After release: confirm target `/privacy` unauthenticated HTTPS 200 and exact approved bytes; both languages/contact/deletion steps present; no crawl/auth/geoblock restriction; canonical alias behavior; public root and representative OS/Crew/Feedback routing unaffected. Record actual publication date/time and deployed SHA. Meta metadata/publication and messaging activation still require separate authorization.

## Published outcome — 11 October 2026

Explicit operator approval authorized version 1.0 and the scoped shared-project rebuild. Exactly one Production Git deployment was created: `dpl_6WUVyNm8C1CbcMUrKGFDjSJxmowH`, READY, project `fnb-system`, SHA `f2f293c71738d3f0b603cfd425515294687aed28`. Local main, origin/main and the READY deployment matched. Production runtime diff: approved static policy and two minimal routing files only; no application-source/dependency/schema/Edge/secrets or Marketing feature change.

**Effective publication date: 11 October 2026 (Asia/Kuala_Lumpur).** Vercel READY timestamp: 02:06:25.212 MYT; first direct unauthenticated HTTPS byte verification: 02:07:08 MYT. Exact approved policy SHA-256 remains `4fd83b4ada9cee8766ff9a93e5c9fd2be07e4cf0729047adb2d4149136b495cc`. The public text says effective upon first public publication; this record establishes that date without changing the approved bytes or creating another Production deployment.

Production Release smoke passed: `/privacy` and `/privacy/` HTTPS 200, correct UTF-8 HTML, both languages/11 sections each, no scripts/auth/robots restriction, exact byte comparison. `/privacy.html` redirects to `/privacy`; www preserves the policy path to apex. Desktop and 390x844 mobile reviewed; width 390/body width 390, no horizontal overflow, BM navigation works. Public root, authenticated OS dashboard, Crew login and Feedback unavailable-link state render; OS/Crew/Feedback entry HTML remains byte-identical to the old Production deployment, and existing JS/CSS assets return 200. Observed browser error count is zero on all four smoke tabs. No business writes or private fixture actions were used.

DPO/controller-registration applicability, retention approval, processors/transfers, manual export inventory and recovery/key custody remain **Open**, not resolved by publication. Staging privacy infrastructure stays accepted/closed. No Marketing Hub deployment to Production, Meta metadata edit, Meta app publication or messaging activation occurred.

Approved policy and public route boundary are reconciled to dev; its explicit Staging-host exception keeps the canonical review URL available. The Production routing candidate limits the policy rewrite to feedx.my; no second Production push/deployment is part of this reconciliation.
