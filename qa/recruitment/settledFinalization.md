# Settled recording finalization regression

QA level: L3 Canonical. Scope: ended-attempt finalization only.

## Finding

Original Service Crew acceptance attempt `08216747-f5e5-4d2e-9c2d-88e5b7e7f160` ended 2026-10-05 05:50:54 UTC with 38 durable transcript turns. Its single unit became Invalid at 05:50:55 UTC, with 59 acknowledged transport chunks (17,661,773 bytes), no verified dimensions/file manifest. Candidate lease expired at 05:52:26 UTC. No `interview_finalized` event/report existed. The Invalid state was already allowed by the classifier, but only a live candidate session could invoke it; no independent reconciliation existed. Bounded diagnostics do not identify the particular final client exception, so none is asserted.

## Fix and verification

Forward migration `20261005084714_recruitment_settled_evidence_finalization.sql` extracts the unchanged classifier into a service-only, locked, terminal-idempotent helper. Existing candidate session authorization delegates to it. Existing pg_cron runs settled reconciliation each minute after the two-minute ended-attempt grace and browser lease expiry. Capturing/Pending units block reconciliation; no recording/receipt/transcript is mutated. The existing report enqueue is reused without new report logic or provider calls.

- 15 focused Phase 3 / recording recovery tests passed.
- Staging rollback fixture checks passed: Invalid-only => Failed/Failed and report source available; verified+Invalid => Partial/Partial; Pending/Capturing remain Finalizing; live lease/recent end not prematurely reconciled; active interview rejected; terminal retries preserve result with one event/report; anon/authenticated cannot execute trusted helper/reconciler. Metadata-only synthetic fixtures all rolled back, with no media created.
- Real scheduled run succeeded at 2026-10-05 08:48 UTC. Original attempt converged to Failed/recording Failed under the unchanged classification, with one queued v3 report containing all 38 turns. Failed denotes unavailable playable recording, not candidate assessment or rejection. Report generation/review uses the existing manager path.
- Original units, receipts, transcript and coverage findings fingerprint before/after: `c04365fea70e812c16ace32206d2ca32` (identical). Invalid media remains Invalid; no repair/fabricated playback or hiring action.

No unrelated Recruitment/runtime/intelligence/UI changes or Production deployment.
