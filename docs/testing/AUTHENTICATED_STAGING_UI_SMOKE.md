# Authenticated Staging UI Smoke

This is a small browser fallback for authenticated FeedX UI smoke coverage. It complements, and does not replace, Vitest, the Staging SQL/RPC verifiers, or the canonical Vercel target guard.

The harness accepts only `https://fnb-system-staging.vercel.app`; Production and Preview URLs are rejected before a browser opens. It always creates a fresh browser context and performs the actual Crew or Admin login flow. It does not inject Crew tokens, use a service-role key, or persist Playwright storage state.

## Commands

- `npm run test:staging-smoke-harness` validates the guard/configuration without credentials.
- `npm run qa:staging:crew-smoke` runs Crew login, Home, Learn navigation, fatal-error capture, screenshots, and 360/390/430 viewport overflow checks.
- `npm run qa:staging:admin-smoke` runs Admin login and opens the read-only `dashboard` route by default. Set `FEEDX_STAGING_ADMIN_ROUTE=reports` only for a Staging QA account that is authorized for Reports.

Crew smoke requires `FEEDX_STAGING_CREW_MOBILE` and `FEEDX_STAGING_CREW_PASSCODE`. Admin smoke requires `FEEDX_STAGING_ADMIN_EMAIL` and `FEEDX_STAGING_ADMIN_PASSWORD`. Supply only Staging-only end-user QA identities through the runtime environment, an approved local secret store, or CI secrets. Never commit credentials, tokens, cookies, or storage state.

Artifacts are written to the ignored `qa-artifacts/` directory. Screenshots are retained for successful smoke runs and on failure; treat them and browser error output as private QA evidence. Traces and video are disabled because login actions/network traces can expose credentials or session tokens. Never attach these artifacts to a commit or export browser cookies/storage state.

Harness safety tests do not prove authentication or application behavior. If runtime QA credentials are unavailable, commit the verified tooling independently and report the real Crew/Admin run as pending, never passed.

Authentication-sensitive or destructive workflows still require their existing authority verification and, where applicable, authenticated UI QA. This smoke suite intentionally does not clock attendance, change passcodes, disable access, or mutate cash/business state.
