# Pay-rule effective ordering forward repair

2026-10-04. Targeted L3 regression and Production release verification.

Migration: `20261004151203_payroll_pay_rule_effective_order_repair.sql`.
It changes exactly two table-qualified lookup statements in
`payroll_calculation_project`: monthly_basic and non_payable. The original applied
fast-decision migration remains unchanged. No table, column, rate or evidence DML
is introduced. Compensation's three indexed effective-date/revision selections
remain intact; decision save/status functions are untouched.

The live schema enforces unique `(rule_code,pay_basis,effective_from)` pay-rule
versions, with an effective-date index. Rule lookup therefore orders by effective
date alone. All eight live functions referring to the pay-rule table were compared
between Staging and Production and audited against the actual schema. A statement
scan rejects any remaining pay-rule ORDER BY revision.

Staging reproduced SQLSTATE 42703 on the synthetic Monthly fixture before repair.
After the single-migration dry-run/application and local DDL rehearsal:

- Monthly calculation projection and authenticated run read succeed (two members).
- All nine canonical rule codes × Monthly/Hourly effective lookups and generic
  pricing calls execute against actual schema, retaining null for unconfigured or
  independently owned statutory PH pricing paths.
- Rolled-back correction of the labelled Save Latency fixture's September 23 day
  to non-payable appends one audit, creates no calculation revision during save,
  preserves earlier time records and produces RM800 Regular gross, exactly RM40
  below the previous approved Regular gross.
- Compensation read optimization and no-month-calculation save boundary pass.
- 15 focused hook/service tests and production build pass; diff check passes.

No existing Stage decisions are retained from this contract (transaction rollback).
No employee-specific September 16 source-evidence issue was investigated or changed.
Production verification uses read-only Phoenix September calculation/projection
reads and before/after evidence hashes; it does not save or correct real decisions.
