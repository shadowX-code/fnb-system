# Management Cash Checkout eligibility

Date: 2026-10-02

## Changes

Scoped release of verified Staging commit `ec67b49f3797580950ea1b4f861a56af3d92cc27`. Active Management may use the existing Count → Allocate → Confirm workflow only with canonical selected-outlet authorization and the outlet Management Checkout toggle enabled. Crew Checkout Positions, Handover initiation and receiver eligibility remain independent. The real employee remains the actor.

## Migration Impact

Only `20261002040229_crew_cash_management_checkout.sql`. Production guards matched the reviewed baseline; rollback-only Production rehearsal and isolated migration dry run passed. Existing settings and receivers were preserved; the new toggle defaults off. Cash functions/signatures/ACLs match verified Staging; 32 independent authorities remain unchanged.

## Deployment Notes

Production-based cherry-pick only; no wholesale dev merge. Isolated build and 49 focused tests passed. Recovery retains prior main `8f2d76fad58f21a19d2f2e3c71351039bb06807a`, deployment `dpl_EFenKFb9Qu9KWsETCFyhmkRmTAvp`, and scoped database definitions/settings/ACL/ledger snapshot under the local release evidence directory. Production smoke is read-only; no cash records or outlet eligibility changes are created for QA.
