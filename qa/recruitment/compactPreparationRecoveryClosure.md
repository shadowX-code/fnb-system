# Compact candidate preparation and continuation ownership

Documentation Impact: Updated `docs/domains/recruitment.md`. QA level L3 (immutable consent copy version and evidence/lifecycle boundary), scoped to preparation/recovery only.

## Physical evidence

Latest physical attempt `940deedc-294b-4ab1-8606-33282bb8fe8a` (canonical `960520e6`) preserved its original consent, configuration and evidence. It successfully reconstructed recording unit 2 and provider generation 2 on the same attempt after a media interruption. Provider traces contain exactly one entry response per generation and one response per committed candidate item; they do **not** prove duplicate client response creation. Generation 2 entry was interrupted at 105532 ms; further AI questions were cleared at 116020 and 122058 ms by candidate speech starts. The transcript subsequently repeated interruption acknowledgements/questions. No claim that these speech starts were acoustic echo is supported by the bounded observations.

The controller discarded cancelled output-buffer clearance and released generated owners before their clearance receipt. Persistent generation instructions also commanded interruption acknowledgement/continuation on every model turn. The fix moves that operational intent to one server-approved first response, fences early live candidate ownership, waits for cancelled generation termination plus actual playback clearance, retains truthful truncation bookkeeping, ignores duplicate speech-start/late old commits and fails missing receipts into the existing fresh-transport recovery surface. It adds no silence delay, voice tuning or old-session reconnect path.

## Preparation

Interview Details combines opening/position/workplace/duration, initial editable name/contact and guidance. Get Ready combines local camera preview/mic activity, the exact server-versioned consent copy, readiness acknowledgement and Start. Consent/device acquisition work in either order; Start needs persisted consent, live local readiness and the existing Ready RPC. Confirmed profiles stay immutable. New immutable version `feedx-interview-v1-concise`, ledger/file `20261004163804`, preserves historical approved/provisional copy and all accepted snapshots. Native microphone-meter activation happens in the Check gesture. Session pre-start mount cannot dispose its parent-owned check.

## Focused evidence

- 53 scoped tests: preparation order/gating, server rejection/retry, historical consent, gesture acquisition, cancellation/playback order, entry intent once/early candidate race, late callbacks, native hangs/rejections, stale tracks/providers/uploads and fresh recovery.
- Production build and `git diff --check` pass; existing large-bundle warning remains.
- `compactPreparationRecovery.rollback.sql` passed against Staging, using protected Recruitment registration and no Employee creation. All contract fixtures rolled back. Checks current consent/readiness authority, same-attempt transcript/fact/coverage continuation, idempotent recovery, stale provider ownership and recording gaps.
- Local changed UI + real Staging provider: synthetic `cdb34337-eb0f-4486-ac89-f9f5447eabc9`; four recording/provider generations, one entry request each, final Partial with six explicit gaps, three verified 640×480 units, one Invalid reload unit, one durable AI transcript. Hung native acquisition, hardware rejection, stale native close/pending upload, cold refresh and dead peer converged into retry/connected states. Private mobile/desktop screenshots at `/private/tmp/feedx-compact-prep` inspected.
- Function `recruitment-realtime` v10 delivered only to Staging `ujkzdaaadnvcfayuldmh`; voice file unchanged. This is technical verification, **not physical iOS or perceived conversation-quality certification**.

Canonical Staging UI verification and final physical acceptance are recorded after delivery. No unrelated Recruitment/Phase 1–3 QA, Hire, Employee creation, Production delivery or `main` mutation.

## Canonical Staging verification

Git integration delivered `167cfe255aeaf0d7e1b2e79cbd8d00613feaa982` as READY `dpl_B2pLLtA4MsT1hr7aXCxYEyz6Yw3m` on canonical `fnb-system-staging.vercel.app`. Concurrent Payroll integration subsequently advanced dev; Recruitment runtime files were verified byte-equivalent across that advance. The target gate passed from a clean dev checkout preserving concurrent Payroll work.

Canonical alias synthetic `ee7d77b0-3689-439e-a2c5-094924b18025` passed compact preparation (390×844 and 1280×900 screenshots inspected), persisted concise consent, device/server readiness, actual initial provider playback, foreground hang/rejection retry, stale close/pending uploads, cold refresh and dead-peer reconstruction. Four generations, exactly one entry response each, one retained finalized transcript turn, six explicit gaps. Saved Partial with three verified 640×480 units and one Invalid reload unit. No human consent, media check or attempt is submitted by automation for the final invitation. Physical iPhone acceptance is still required; synthetic tests do not certify perceived speech continuity.
