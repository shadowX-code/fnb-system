# Intelligence V2 focused closure

QA level: L3. Scope: completion, profile/configuration/job-fact contracts, learning observations and V2 provider behaviour only. No recovery stress or unrelated Recruitment suite.

Primary physical regression: attempt 88af34fa-7af7-4e52-9d5f-a5313d5b3063. Closing playback stopped at elapsed 314243ms. Trusted finish timestamp 2026-10-05 16:09:49.778218 UTC. Its 18,569,521-byte MP4 unit stopped at 16:09:50.866557 and verified at 16:10:26.632988 (36s, beyond the client 30s wait). Reconciliation finalized Completed/Complete at 16:12:00.262072. The page had no terminal polling, retained Finalizing after timeout and always exposed Retry next to Submitting. Physical evidence is preserved unchanged.

Fix: bounded submission reconciliation observes token-authorized canonical terminal state, retries finalization independently of slow upload, and separates pending/retry/terminal presentation. Retry reads the terminal result before lease/media reconstruction. Completion fences later visibility recovery. Media verification/classification remain existing authorities.

Focused client tests: submission delayed/hung/cold-terminal/cancellation; V2 builder/context; changed opening/profile workflow and candidate completion presentation. Production build passes. Staging rollback contract covers V2 protected publication/concurrency (rolled back), pinning, master/job-fact allowlist, multi-area citations, optional equivalence, canonical completion, immutable learning provenance, invalid citation rejection and private grants. No persistent profile publication happens through migrations/tests.

Deployment/provider/runtime results are appended after canonical delivery. Synthetic provider verification never certifies physical mobile audio quality.
