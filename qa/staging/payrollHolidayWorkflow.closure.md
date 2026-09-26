# Public Holidays guided operational workflow — 2026-09-27

## Scope and verification

UI/read-projection change only. Existing source capture/hash, review/publication,
company-selection, PH policy, Payroll and Leave commands remain the owners.
No migration, automatic official fetch/publication, or Production deployment.
Documentation Impact: domain workflow update in `docs/domains/payroll.md`.

Focused persisted Staging verification used an authenticated Owner browser on
`fnb-system-staging.vercel.app/people/payroll`. Runtime code verified at
`08e68b953b67dcd384d222329e1e804b7b599004`; subsequent closure commit is documentation only.
17 Payroll/People suites / 99 tests passed with inert Supabase test configuration.
`npm run build` and `git diff --check` passed; pre-existing chunk-size warning remains.

## Demonstration

1. Empty 2027: Setup Required / Official Calendar not published; unavailable-source
   explanation, with URL/PDF capture secondary under Advanced.
2. Prepared synthetic candidate: actual 12-row list and Review Calendar action.
3. Review: explicit new-record verification and complete-source attestation;
   separate Confirm Calendar Review and Publish Holiday Calendar commands.
4. Explicit classification review: five fixture records marked Required through
   the existing classification command, never inferred from names/geography.
5. Isolated company selection: five locked Required, six optional Selected,
   one Not Selected. Published without a policy-name form. No real-company default
   pointer was changed. The default/all-companies path has service-contract tests;
   persisted publication used only the isolated company exception.
6. Benefit: inline Additional Pay / Replacement Leave copy verified; saved
   Additional Pay, effective 2027-01-01, only for the isolated company.
7. Ready: 5/5 required, 6/6 optional, 11/11 total. Reload restored the same state;
   no duplicate Publish action. Perak view retained eight National + two Perak
   rows and excluded Selangor without changing full-policy totals. Browser errors: zero.

Evidence screenshots (before retirement):
`/private/tmp/feedx-holiday-workflow-empty.png`,
`/private/tmp/feedx-holiday-workflow-review.png`,
`/private/tmp/feedx-holiday-workflow-selection.png`,
`/private/tmp/feedx-holiday-workflow-ready.png`.

## Fixture and exactly-once evidence

All dates 2027-02-01 through 2027-02-12 are synthetic, visibly QA ONLY, not Malaysian
official dates. Fixture has no employees, access accounts, Payroll runs or Leave grants.

- Company: `52ca4f6c-7e31-46a1-be57-23d6ae1aa290`.
- Import: `1d671e17-1bbc-4a9e-b9c0-c127eca69a6b`.
- PDF SHA-256: `10e7155e772d5443cd793b7b20342b763816c8f9ae6fa3ca16040ccb4d932ebe`.
- Source calendar: `6acc2ad3-07c9-4c99-9c42-a511842958bf`.
- Explicit-classification calendar: `83732ae9-419f-4834-82d1-438dea88dea2`.
- Company selection: `be8e999e-c8d8-4d22-9d3b-86452076776a`.
- Benefit: `97255866-5c0f-458e-aee0-6bcca2fd14ce`.

Source captured / parsed / needs_review / approved / published events each count 1.
Each of the two intentional calendar revisions has one publication; company
selection publication count 1, company assignment count 1, benefit version count 1.
No extra mutation on refresh.

## Cleanup

Canonical `legal_entity_save` deactivated the company. Canonical calendar-retire
commands retired both calendars (two retirement events); candidate-retire removed
the import from operational candidates. Post-cleanup authorized annual read returns
zero operational 2027 calendars/policies, and candidate read returns zero candidates.
Immutable source bytes, definitions, policy/benefit versions and audit history remain
retained; nothing was hard-deleted. Existing companies, Payroll and Leave unchanged.

PUBLIC HOLIDAY END-TO-END ADMIN UX = PASS
