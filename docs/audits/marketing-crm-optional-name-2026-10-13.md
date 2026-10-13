# CRM Customers and Import V2 focused acceptance

13 October 2026 — L3 Canonical; Staging only.

The forward optional-name migration changes canonical validation and read projection without rewriting existing customer records. Platform identity, normalized phone uniqueness, all-affected-Brand access, revision/snapshot checks, POS import provenance and consent/suppression authorities remain intact.

## Verification

- Authenticated database-role rollback rehearsal: phone-only preview/import, persisted null name, manual profile changes/clearing, repeat request idempotency, blank imported name preservation, invalid/duplicate phone rejection, POS zero/provenance and unchanged consent passed. All disposable rows rolled back; no real customer edit was committed.
- Focused CRM/shared-table/manual WhatsApp regression: 66 tests passed in eight files. After the final confirmation-copy refinement, its two affected suites passed again (23 tests). Production build passed; only the existing chunk-size warning remains.
- Canonical authenticated Staging: ordinary row-cell click and Enter open Customer Detail; Edit and Consent open independently; Email/Gender/Birthday controls use canonical fields. All thirteen column options are present, optional columns display and can be reset. Missing POS metrics are unavailable rather than zero.
- Read-only synthetic CSV browser preview with no Name column: New record selected, exact Email/POS differences expandable for an existing acceptance recipient, invalid phone unselectable. Final summary showed two ready, one new, one update and one excluded; final Import remained disabled without confirmation. The dialog was cancelled; no mapping, job, customer or consent write was submitted.
- Desktop/mobile Light/Dark presentation inspected. Narrow layout has no document horizontal overflow (requested 390px viewport; browser CSS viewport 433px due zoom). Existing summary/table/filter behavior is preserved.

Backend/UI baseline: commit `22c095d7291bbd3e4aff6328f45e40691b6c0e48`, READY Staging deployment `dpl_CBjfS5SJp75x3xXFdi9wfqE6KvYy`. Follow-up contains only confirmation duplicate-copy removal, existing regression selector updates and this evidence.

No Production, real customer-data mutations, outbound messages or provider permission changes. Optional names do not imply consent. POS fields remain source cumulative snapshots and cannot be directly edited through Customer Edit.
