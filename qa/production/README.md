# Production Read-Only Smoke

Production smoke is a read-only consumer. This directory does not provide a Production runner or credentials.

For any Production UI smoke that opens a row action, import `clickRowScopedView` from `readOnlySmokeGuard.mjs`. Supply the exact business identity shown in the first table cell; the helper requires exactly one matching row and one visible, hit-testable `View` button. Mutation actions are rejected. Do not bypass this helper with a broad action selector or extend it to mutation actions.

Run `npm run qa:production:smoke-guard-test` before using or changing the guard. This test is local and makes no Production request.
