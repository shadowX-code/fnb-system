# Crew Frontend Regression Guardrails

## Owners and scope

`qa/crew/` is the deterministic, local-only browser renderer suite. It mounts the actual `CrewMobileApp`, feature renderers and shared primitives. It uses the existing EN / 中文 / BM resources and synthetic long domain labels; it does not maintain a second UI template or snapshot every pixel.

`playwright.crew.config.mjs` owns the 320 / 360 / 390 / 430 CSS-pixel matrix. Each width runs all three locales. Home, Attendance, Schedule, Tasks, Cash Checkout, Learn/Onboarding, Growth/Performance, Reward, Me and Leave are covered.

The separate loopback Vite configuration aliases only `crewService` to synthetic read responses. It refuses deployment builds, does not load `.env` files, and scans only the fixture entry. Browser tests block non-loopback requests. Unimplemented reads and all mutations fail closed. Neither this entry nor the fixture is imported by the production app. Synthetic session data is local to the isolated test browser; real Staging tokens/storage state must never be copied into it.

## Commands

```sh
npm run test:crew:browser
npm run test:crew:browser -- --project=ms-320
npm test -- --run src/features/crew src/app --maxWorkers=2
npm run test:staging-smoke-harness
npm run build
git diff --check
```

Use the Chromium revision installed for the repository's Playwright version. Browser suite parallelism is bounded to two workers; avoid running unlimited Vitest workers alongside browser tests. Failure screenshots and diagnostics stay under ignored `qa-artifacts/crew/`. They are diagnostic evidence, not canonical visual baselines.

## What is protected

- Geometry: document horizontal overflow, text/control containment, intentional ellipsis/line-clamp exceptions, horizontal category scrollers, and final-action hit testing above bottom navigation. Invisible expanded helper touch areas are not clipped text.
- Long copy: task/category/lesson/module/skill/outlet labels plus actual localized status and section text. Add new edge-case inputs to the fixture rather than hardcoding test data in runtime components.
- Shared overlays: BottomSheet, HelpSheet and MobileModal portal ownership, one active focus trap, trigger restoration, Escape/backdrop close, nested scroll-lock retention and reduced motion. PerformanceDetailSheet is exercised through the real Performance route. Clock reason selection must replace, not nest, its confirmation sheet.
- Input flows: Cash Count, Leave dates/reason, Clock exception reason, Task issue note. Editable fields are at least 16 CSS px. Short-height viewport checks verify that key actions remain reachable without clicking Submit/Confirm.
- Routes/session: real browser hash navigation, legacy/invalid fallback, reload, back/forward; existing App bootstrap tests retain the Admin/Crew loading boundary. Hook/component tests cover generation/token identity, stale success/failure, token rotation, route switching and clearing employee projections on logout.
- Ownership: `CrewFrontendOwnership.test.js` follows the mobile import graph, including lazy imports, to keep dialog portals in the two shared primitives and direct Supabase/fixture dependencies out of mobile consumers. Shared status/count/buttons/help/page/loading primitives retain their existing contract and interaction tests; do not replace these with exact page DOM snapshots.

## Maintenance rule

Run the browser matrix for changes to Crew shared CSS/primitives, route composition or responsive feature layout. Run the relevant route/session suites whenever root orchestration changes. A new meaningful Crew screen or overlay should join this matrix using its canonical route/shared primitive, not a page-local mock shell.

Treat failures as evidence to investigate: first confirm fixture shape, translated accessible name, data readiness and intentional truncation; fix runtime CSS only when the real renderer demonstrably overflows or hides an action. Do not change business contracts to make the harness pass. Do not remove valid Reward fixture values merely because an older assertion once used them.

## Staging and remaining device boundary

The authenticated [Staging smoke](AUTHENTICATED_STAGING_UI_SMOKE.md) remains separate. It uses real Staging-only end-user login and canonical server contracts, now at all four widths. Local renderer success is not authenticated Staging success and does not validate RPC/RLS authority.

Chromium viewport resizing is a keyboard-space proxy, not a physical iOS keyboard or browser-chrome test. Safe-area CSS ownership is checked structurally; desktop emulation cannot prove physical notch/keyboard behavior. Keep targeted iOS Safari device QA when changing keyboard, safe-area or scroll-lock behavior. No pixel-perfect screenshot SaaS or external visual baseline service is required.
