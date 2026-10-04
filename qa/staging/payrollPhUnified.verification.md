# Unified PH Pay Treatment — L3 verification

## Scope and delivery

Single default/occurrence cash treatment; existing `Additional Pay` calculator extracted
once and reused. Forward migration: `20261004120041_payroll_unified_ph_pay_treatment.sql`.
Canonical Staging Supabase: `ujkzdaaadnvcfayuldmh`; no Production mutation/deployment.
Implementation delivery: `3a71efab025c1bee146397409eebfe74ad72df84`, READY
`dpl_4BJCAK2ypBqhceohBQDDLwxADPyg` on `fnb-system-staging.vercel.app`.

## Verified contracts

- Exact migration rehearsal from current Staging function definitions, local rollback.
- Single-migration linked Staging dry-run/apply; ledger 639 after apply.
- `payrollPhUnified.rollback.sql`: canonical Company Monthly RM100 on Basic RM2600;
  Hourly/regular part-time RM40 on five hours at RM8; independently priced Regular;
  actual preview delta equals canonical Gross delta; retry, correction append,
  no company layering over Custom; dated defaults; separate statutory PH OT and
  unavailable OT fail-closed; prior legacy statutory/custom/zero contracts retained.
- Staging rollback contract passed; synthetic fixtures rolled back.
- Existing finalized snapshot hash `4ffd823dc9899816bee4ccdc7308de83` unchanged.
  Existing policy and Replacement Leave grants unchanged by migration/contracts.
- `payrollPhUnified.render.mjs` rendered six server-composed Draft/Final PDFs from
  actual Staging calculations: exact Gross, matching earnings, Unicode, single-page
  renderer. Existing legacy custom/OT renderer also passed locally.
- Private calculator and legacy quote are not executable by anon/authenticated;
  scoped authenticated preview/save and finalized denial remain covered.
- Existing security advisor findings reviewed; neither new private helper is exposed.

## Authenticated runtime

Labelled `QA ONLY Unified PH` September fixtures only:
Settings displays existing Company default and unchanged read-only formulas;
history collapsed. Monthly review preselects Company and previews RM100, then saves
Public Holiday Allowance RM100. Hourly previews Regular RM40 + allowance RM40 = RM80,
then saves these exact lines. Missing statutory evidence disables Statutory and shows
the warning without a statutory form, acknowledgement or reference field.
First Company confirmations recorded server-owned reason and
`visible_explicit_confirmation` audit evidence. Hourly Custom correction RM50 previews
an RM30 reduction, saves RM50 and retains prior Company RM40/Regular RM40 decision.
Normal review has no separate benefit selector or PH Pay Profile controls.

Retained Leave compatibility tested in Staging rollback: canonical legacy grant;
new Statutory cash default; old Leave projection still resolves Replacement Leave;
cash preview remains blocked by the grant and does not revoke/consume it.

## Boundaries

Company cash does not establish statutory compliance. Missing statutory PH OT remains
blocking for Company treatment rather than inventing an overtime amount. Custom/zero
retain existing cash-override and contribution semantics. Other statutory, employment,
published-calendar and finalization gates remain independent. No real employee
evidence was confirmed. Runtime fixture employer/outlet retired after verification;
audit evidence retained. No Production release is included in this task.
