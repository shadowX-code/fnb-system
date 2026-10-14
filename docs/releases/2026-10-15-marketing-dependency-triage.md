# Marketing release candidate dependency triage

15 October 2026, Asia/Kuala_Lumpur. Baseline RC `c1067ea17c7aaafd2761b5e5b2c283ab683b645b`.

**The dependency gate is cleared for the current execution-closed release paths: zero confirmed release-blocking findings, three already mitigated and eleven safely deferrable.** All 14 packages remain at their existing versions; their audit warnings have not been removed. This is a finding-by-finding reachability decision, not a claim that the packages are patched or safe for every future use. Production rollout remains **NO-GO** for the independent security hotfix, installation/bootstrap/custody and provider authorization gates.

## Scope and evidence

The saved `feedx-rc-audit.json` supplied all 14 entries. No new broad repository audit or npm audit was run. Inspection was limited to those dependency chains, package classifications, relevant entry points, export callers and release scripts. Existing candidate build, worker, OAuth/HMAC and environment evidence was reused because application code and dependencies did not change.

The audit counts affected package entries rather than 14 independent vulnerabilities: `@playwright/test` inherits Playwright's browser-installer advisory, and `vitest` shares the mocker advisory with `@vitest/mocker`. Undici's single package entry includes multiple 8.x advisories. Severity alone does not establish execution of an affected API.

## Exact finding classification

| Package and saved severity | Installed version and dependency path | Classification | Current exposure and deferral condition |
|---|---|---|---|
| `@babel/core` — low | 7.29.0 via `@vitejs/plugin-react` | Safely deferrable | Arbitrary file read through sourceMappingURL requires attacker-influenced source in Babel. RC transforms reviewed repository source, not POS uploads, provider HTML or user content. Patch before accepting untrusted build source or build plugins. |
| `@playwright/test` — high | 1.55.0 → `playwright` 1.55.0; dev dependency | Safely deferrable | Inherits the installer finding below; not a second runtime issue. Production handlers do not import the test runner. Patch with Playwright before any affected browser-download step. |
| `@vitest/mocker` — moderate | 4.1.10 via dev-only `vitest` | Safely deferrable | Redirect-mock path traversal requires the affected test/mock server path. Verification used `vitest run`, not a public mock server; no such endpoint is deployed. Patch before exposing mock/test servers or accepting untrusted mock descriptors. |
| `baseline-browser-mapping` — moderate | 2.10.27 via Autoprefixer → Browserslist | Safely deferrable | Invalid-input process termination affects build target handling. The RC uses repository-controlled configuration; no Marketing request invokes it. Patch before allowing external users to supply target queries or executing new untrusted configurations. |
| `browserslist` — high | 4.28.2 via Autoprefixer and Babel compilation targets | Safely deferrable | Unbounded distinct-query cache and untrusted custom statistics are build-process findings here. No dynamic customer query or uploaded stats file enters those dependencies. Patch before processing untrusted/repeated target queries or custom stats in a long-lived service. |
| `dompurify` — low | 3.4.14 via `jspdf` 4.2.1 | Already mitigated | Both saved advisories require `IN_PLACE`. FeedX has no direct DOMPurify/IN_PLACE caller. Its two PDF exporters rasterize with `html-to-image`, then use `jsPDF.addImage`; they never call `jsPDF.html` or install DOMPurify hooks. Patch before introducing the affected sanitization/reparse mode. |
| `esbuild` — low | 0.27.7 via Vite | Already mitigated | Saved advisory affects the development server on Windows. RC uses `vite build` and esbuild build/bundle APIs; Production has no esbuild development server. Patch before using that Windows server path. |
| `nanoid` — high | 3.3.12 via PostCSS | Safely deferrable | Saved issues require invalid generator sizes (negative or zero, depending on generator). No FeedX direct Nanoid caller or customer-controlled generator size exists; PostCSS operates on build input. Patch before introducing custom generators or untrusted size inputs. |
| `playwright` — high | 1.55.0 via dev-only `@playwright/test` | Safely deferrable | Advisory is browser download/install without certificate authenticity verification, not ordinary browser-driving. This candidate's verification used no Playwright browser installer. Creator runtime imports `playwright-core` and `@sparticuz/chromium`, whose binary is a locked npm artifact; it does not invoke Playwright's downloader. Version 1.55.1 or later is required before future affected download/install QA; do not treat this deferral as authorization to run that installer. |
| `postcss` — high | 8.5.14 direct build dependency, also through Vite/Tailwind | Safely deferrable | Saved flaws concern sourceMappingURL auto-loading, including an unset `from`. Candidate CSS is reviewed repository build input. No handler passes POS/customer/provider content to PostCSS. Patch before untrusted CSS/source-map processing or a public CSS compilation service. |
| `source-map-js` — high | 1.2.1 via PostCSS, Tailwind and dev jsdom | Safely deferrable | Indexed source-map offsets can cause event-loop denial of service. No Marketing endpoint reads user-supplied maps. Builds use repository/dependency maps; jsdom is test-only. Patch before serving untrusted indexed source maps or accepting unreviewed build maps. |
| `undici` — high | 8.10.0 via dev-only jsdom 30.0.1 | Safely deferrable | The saved 8.x TLS/cache/WebSocket/retry/decompression advisories apply to this jsdom dependency. It is not a Production request-handler dependency. Creator's separate Cheerio path resolves Undici 7.30.0, outside the saved 8.x ranges; Creator fetches also use its bounded Node HTTPS implementation. Patch jsdom's Undici to a compatible 8.10.2+ before real/untrusted network or affected APIs in tests; mocks-only QA remains within this decision. |
| `vite` — high | 7.3.3 direct build tool | Already mitigated | Saved advisories affect Windows editor UNC handling and development-server file access. Production uses built static assets plus explicit API/Edge entry points; it runs no Vite dev server/editor endpoint. Patch before exposing an affected Windows development server. |
| `vitest` — moderate | 4.1.10 direct dev dependency | Safely deferrable | Same redirect-mock issue as mocker. No Production import; bounded `vitest run` uses controlled test definitions. Patch together with mocker before exposing the affected test-server path. |

None is classified as unrelated merely because a package predates Marketing: each was traced to its actual RC consumer. None meets the release-blocking classification on the inspected current paths. Deferral depends on keeping the stated input and execution boundaries; it is not a permanent exemption.

## Verified callers and boundaries

- `src/components/print/a4TableExport.js`: `toCanvas` → PNG → `jsPDF.addImage` → `save`; no HTML sanitization mode.
- `src/features/reports/services/reportPosterExport.js`: existing PNG capture → `jsPDF.addImage`; no `html` or `IN_PLACE` invocation.
- `server/creatorExtraction/profiles.mjs` and `inspect.mjs`: Cheerio `load` parses bounded retrieved markup; no Babel/PostCSS/source-map/test-server invocation.
- `server/creatorExtraction/network.mjs`: bounded Node HTTPS retrieval; no affected Undici 8.x API.
- `server/creatorExtraction/browser.mjs`: Playwright Core drives the separately packaged Chromium executable, not Playwright browser installation.
- `package.json`, `qa/staging/runStagingSmoke.mjs` and deployment scripts: test-runner/build usage, with no browser-install step added by this RC. A future installer needs the patch before execution.
- No runtime entry point imports Vite, Vitest, mocker, Babel, Browserslist or PostCSS for handling customer/provider requests. Production external execution remains hard closed.

The DOMPurify preconditions and Playwright installer scope were checked against the primary [DOMPurify hook advisory](https://github.com/advisories/GHSA-p98j-92pf-mc4p), [DOMPurify rawtext-root advisory](https://github.com/advisories/GHSA-6688-9rhm-gjv2) and [Playwright installer advisory](https://github.com/advisories/GHSA-7mvr-c777-76hp). The other advisory titles/ranges come from the existing saved npm evidence; no new all-repository scan was used.

## Changes and proportional verification

Changes are documentation only: this complete ledger and the prior readiness report's dependency-gate wording. No package manifest/lock, application code, migration, environment profile, authority or execution control changed. No blocker was invented solely to justify an upgrade.

`package.json` SHA-256 remains `71880a729488c1fe59ab1c427c025a465a454ea94f58c5919bb94aa52bdbb304`; `package-lock.json` remains `bfdafc058b275e7ac8300eabf8d480986986c545d9b414aacdb171fc4ba02a92`. All 133 rehearsed migration hashes match the manifest. The overlay and separate security prerequisite patch also remain byte-identical to the base RC. Diff review confirms no non-documentation file changed. The previous Production build, six Edge bundles, focused security tests and environment/worker tests remain applicable, so they were not redundantly rerun for text changes.

**Resolved:** the disposition of all 14 saved findings and the earlier blanket dependency blocker. **Patched package findings:** zero. **Remaining npm findings:** the same 14, with the classifications above. **Confirmed current dependency release blockers:** zero.

## Updated GO or NO GO

**GO for the dependency gate on this execution-closed candidate and the documented trusted build/test paths.** Do not run the affected browser installer, expose vulnerable development/mock servers or introduce untrusted compilation/sanitization/network inputs under this decision.

**NO-GO for Production rollout overall.** The separately reviewed security hotfix remains unapplied and outside the candidate's code; exact migration/runtime/frontend release authorization, independent secrets and erasure/scheduler custody, Brand/access bootstrap and managed runtime smoke remain outstanding. Meta Business Verification/App Review, Google OAuth/folders, callback registration, assets and any external activation retain their separate approvals. No Production deployment, merge, database migration, provider change or external execution occurred.

A routine compatible toolchain refresh can patch these deferred advisories in its own scoped workflow. It is not a prerequisite for the currently inspected Production paths, and this task does not authorize future unsafe use of their affected APIs.

Documentation Impact: Updated release dependency ledger and readiness report; runtime contracts unchanged.
