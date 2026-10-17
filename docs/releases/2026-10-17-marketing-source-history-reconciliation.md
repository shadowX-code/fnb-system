# Marketing Source / History Reconciliation

Date: 17 October 2026

Status: prepared locally on `codex/marketing-source-history-reconciliation`, based only on verified Production/main `cefc744c10b75da0683b75060253524bcdfe8b87`. Not pushed, merged, deployed or activated. This record is not Production authorization.

## Changes

- Incorporated local dev reconciliation `4d29ba31f6e6e5b6594385d40dff276ac6130ec0` by scoped cherry-pick, resolving documentation conflicts against the current Production baseline. Original local dev and all original dirty worktrees remain unchanged.
- Recovered the deployed Inbox v19 shared execution helper verbatim: controlled lists remain mandatory; normal mode independently honors any supplied valid account/peer emergency restrictions and fails closed on malformed lists. Canonical conversation/Role/Brand/window/approval guards remain mandatory.
- Recovered Privacy v18 entry point and checkpoint helper verbatim. Both Production privacy flags remain required before I/O. Original/checkpoint namespace validation, immutable encrypted read-back, current hold/review checks, SQL acknowledgment before exact deletion, resumability, deduplication and fail-closed restore remain intact. No privacy activation or scheduler is introduced.
- Corrected stale Marketing runtime guidance and the older Employee/Creator readiness record. Earlier Friends Corner connectivity diagnosis is historical and explicitly corrected; Shared Creator enrichment remains organization-authorization gated.
- Marked five unavailable Production-document links as Staging-only evidence retained on dev, rather than importing unrelated historical QA or the XHS pilot into this candidate.

The [checksum manifest](2026-10-17-marketing-source-history-reconciliation.json) records deployed bundle fingerprints, per-file comparisons, recovered migration SHA-256 values and identity aliases. It contains no credentials, provider payloads or client-readable secret material.

## Migration Impact

All six restored source files are already applied in Production. Their exact UTF-8 bytes match SHA-256 computed read-only from the recorded ledger statements; the two incident files also retain their completed receipt checksums. No SQL was executed and no ledger was repaired:

| Version | Source |
| --- | --- |
| `20261015071330` | Inbox analytics social scope |
| `20261015174328` | Privacy journal compaction |
| `20261016062921` | Planner non-retryable revision conflict, recovered through `4d29ba31f` |
| `20261016070206` | Shared authorization cached read plans, recovered through `4d29ba31f` |
| `20261016133152` | Ads report finalization |
| `20261016141927` | Ads packed-checkpoint fast path |

Preserve these historical identity mappings; do not generate duplicate alias migrations, rename applied shared-environment files, replay SQL, or change either live ledger:

| Source identity | Staging ledger | Production ledger | Disposition |
| --- | --- | --- | --- |
| Staging Git `20261014030902`; Production source `20261014032018` | `20261014032018` | `20261014032018` | Same public-inspection source; keep Production source identity in this candidate. |
| Staging Git `20261014033913`; Production source `20261014033939` | `20261014033939` | `20261014033939` | Same inspection-budget source; no reapplication. |
| Staging Git `20261014045243`; Production source `20261014045332` | `20261014045332` | `20261014045332` | Retain Production variant; historical Staging SQL differs, but current inspected authorities match after project-ref normalization. |
| Canonical file `20261016074750_marketing_task_attachment_documents.sql` | `20261016074750` | `20261016083440` | Exact source/Production statement SHA-256 match; one logical change, not another pending migration. |

`20261015175316_platform_team_nickname_projection.sql` has no separate Production ledger row, but the current Production Team projection is identical to Staging and nickname-aware. It is semantically represented, not a newly required Production migration. The Production-only runtime overlay `20261014184308` is already applied; never replay its historical job deactivation.

Never use a broad `db push` to reconcile these histories. Before any separately approved future migration, compare actual ledger versions and these aliases; apply only genuinely new approved SQL. Staging and Production ledger counts differ for other domains and must not be forced equal.

## Source Equivalence And Remaining Differences

Inbox: 10/11 bundled files match candidate source exactly, including entry point and execution helper. The retained `metaGraph.ts` is the newer released main dependency with bounded official Page-follower reads and sanitized diagnostics. Downgrading it to the older Inbox copy would regress other released consumers; Inbox delivery authorities are not changed by these additions.

Privacy: 7/8 bundled files match exactly, including entry point, checkpoint, journal, Blob, environment and security code. Its transitive execution helper now uses the stricter live Inbox version. Publishing/OAuth functions are unchanged; the difference only preserves independently scoped staff-reply restrictions, which Privacy does not call. Future Edge delivery must be separately approved and verify the resulting bundle, not assume all live functions share one historical dependency snapshot.

Unchanged older Ads/Drive bundled helpers are not redeployed or imported here. The current Meta/Worker source and all frontend files retain the verified Production baseline. No Staging Creator Inspection optimization, XHS Reader backend/drawer or unrelated dev feature is included. Historical OAuth task-evidence behavior is represented in current deployed authorities; old privacy/QA notes are not authorization to repeat completed acceptance.

## Runtime Configuration Reference

Audited snapshot, not a desired-state change: Production publishing enabled/controlled; staff replies enabled/normal; publishing and Inbox OAuth opt-ins enabled. AI and Ads execution remain disabled. Automatic Ads history is implemented but its database policy is false in both environments. Production privacy processing/retention flags are absent, so processing remains disabled. Worker Job 11 and CRM Job 12 are active; housekeeping Job 10 is inactive.

Production's retained `MARKETING_INBOX_SEND_ENABLED=false` is a legacy Staging input, not the Production staff-send authority. Normal-mode account/peer lists can be intentional emergency controls and must not be discarded as obsolete. Installed privacy credentials remain recovery material even while processing is disabled; no credential/settings deletion is proposed.

## Verification

L3 authority-sensitive source recovery, with no new live authority rollout. Ninety-one focused local tests passed using mocked transports and in-memory evidence: execution modes/emergency restrictions, canonical denial, both privacy gates and operator authentication, checkpoint preservation/resume/corruption/conflict/hold handling, worker scheduling, OAuth routing, Inbox recovery and Production Creator fallback. Scheduling fixtures were corrected to supply the actual numeric test account and channel expected by existing runtime guards. No assertions or runtime gates were weakened.

The Creator compatibility test was rerun without the shell's Staging project/environment overrides. No application defect was inferred from that initial test contamination. No broad QA, build, provider calls or shared-environment mutation was needed to recover already verified source. Source/checksum/provenance, original-worktree preservation, scoped diff and documentation links are checked independently.

## Deployment Notes

This candidate changes local Git only. Push approval, main-update approval and any Production/Edge delivery or configuration activation are separate gates. Even a dev push may trigger canonical Staging delivery; no push is included here. Preserve `origin/dev`, local dev `4d29ba31f` and Production/main `cefc744c1` until explicitly authorized otherwise. Recheck all live fingerprints and branch tips before any later delivery.
