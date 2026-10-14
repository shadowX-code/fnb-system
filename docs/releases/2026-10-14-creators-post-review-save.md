# Creator Post review and Collaboration save feedback

QA L2 workflow plus focused authenticated canonical RPC regression. Documentation Impact: `docs/domains/marketing.md` updated. Staging only; no migration, new permissions, provider settings or paid extraction.

## Findings and fix

The existing Collaboration form passed native validation. Its mutation handler withheld success and kept Saving active until a second whole-workspace read completed; both success and request feedback could also be behind the open drawer. It had no bounded RPC completion path. A confirmed write followed by a failed read was handled as a failed save after clearing the retry fingerprint. This could encourage stale retries, while hidden native Select validation suppressed the usual browser prompt.

Confirmed command results now update the relevant local projection and acknowledge success inside the drawer before optional enrichment. Late enrichment only refreshes the catalog; it cannot remount an open drawer over later edits. Superseded refreshes are ignored. Other confirmed Creator writes also cannot be reported as failed creates just because enrichment failed. RPCs have a 30-second deadline and transport cancellation; uncertain command failures keep the exact request fingerprint for retry through canonical server idempotency. A running-operation guard prevents concurrent UI submissions. Native validation and request failures show actionable footer feedback; unsaved values remain on failure.

This is not a claim that transport cancellation rolls back a committed server command. Exact retry identity is retained for ambiguous outcomes, and server revision/authorization checks remain authoritative.

## Post review

- One compact preview with actual available media, caption excerpt, date, platform/type and observed metrics. Contextual Edit Details and canonical Lightbox; no duplicate full-size preview/form.
- Save Post is the explicit link and published-URL confirmation. Routine checkboxes are removed; existing server confirmation flags still record the manual actor/time and enforce URL identity, Brand/Creator/account scope, revision and duplicate rules.
- Collaboration context and the originating plan are inherited. Multiple candidates are not guessed. Verified conflicting Creator identity requires an explicit resolution. A duplicate is linked through the existing command, never inserted twice.
- Successful/partial public extraction preserves source, capture time, available metrics and date precision. Unknown dates stay empty. Authorized Meta reference data remains read-only without automatic copying under the existing privacy contract.
- Enter manually uses the canonical URL-preview RPC without any browser/paid-provider lookup. Saved public observation evidence is not resubmitted on ordinary edits, preventing duplicate metric observations.
- Planned/published rows are more compact; shared platform icon dimensions and published/total projection remain unchanged.

## Verification

Focused tests cover successful, partial and unavailable extraction, no mandatory checkboxes, inherited plan/Creator, duplicate reuse, identity conflict resolution, genuine zero, date precision, native validation, rejected writes, exact retry identity, concurrent submit denial, stalled enrichment and retained subsequent edits. The existing authenticated rollback-only SQL proves explicit publication evidence, stable identity/metrics/history, Brand/revision denial, last-evidence guard and exact command retry. All fixtures roll back.

Build/diff checks and final authenticated Staging UI/screenshots are recorded with the final commit/deployment in the completion handoff. No paid XHS request or external integration test was repeated.
