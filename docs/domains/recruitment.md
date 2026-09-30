# Recruitment and AI Interview

## Ownership

People owns Recruitment before employment. `recruitment_applicants` identifies a person and `recruitment_applications` connects that person to an opening. Neither is an Employee, Auth user, or Crew identity. Position, workplace, Legal Entity, and eventual Employee creation remain with their existing People and Restaurant masters. An opening targets exactly one canonical workplace and one active Legal Entity in V1. Restaurant workplaces resolve to an Outlet; Factory and Management are the established non-outlet values.

The `recruitment` module is one Admin workspace at `/people/recruitment`. `recruitment.view` reads scoped openings, applications and interview state; `recruitment.manage` also saves openings, registers applications, and issues/revokes invitations. Restaurant outlet scope is checked for outlet-targeted openings. Phase 1 introduces no manager hiring decision or Employee conversion.

## Opening and interview configuration

An opening is Draft, Open, or Closed. Closed openings cannot reopen in Phase 1. An opening references an existing Job Position and Legal Entity. Published job-facing values are snapshotted on each application. Position, workplace and legal employer cannot change after an application exists.

Every opening save creates a versioned interview configuration. It contains required evidence topics, scenario briefs, EN/BM/Chinese language guidance, target and maximum duration, candidate instructions, and conversational AI instructions. Required topics are evidence targets, not a universal question script. An invitation creates one durable interview attempt pinned to the opening's current configuration version. A later opening edit does not alter an issued attempt.

## Invitation and candidate preparation

The server creates a random 256-bit invitation token and stores only its SHA-256 hash. The public URL is `/i/{token}` on `interview.feedx.my`. Issuing a new invitation revokes earlier invitations for that application. Expiry, revocation, and Open opening status are checked on every public operation. Anonymous callers receive only a minimal job and profile projection; direct table grants remain revoked and all Recruitment tables have RLS enabled.

The candidate confirms a minimal name/contact profile, accepts three versioned consent purposes, and checks camera and microphone before the attempt becomes Ready. Consent is a pinned copy snapshot with timestamp and application/attempt references. The current `phase1-provisional-v1` wording is explicitly provisional and must be replaced with approved policy copy before real candidate collection. The browser device check is a readiness declaration, not server proof of media quality. Phase 1 does not start AI voice, capture a recording, upload media, generate a transcript, analyse evidence, or make a hiring decision.

The public interface mounts separately from Admin and never creates candidate Auth or Crew access. The browser preview and microphone meter use a local media stream and release tracks on unmount. Device loss removes the local Ready check. The persisted Ready milestone indicates a successful check at that time; Phase 2 must require another check at interview start.

## Phase 2 boundary

The attempt has its own durable status and pinned configuration. Realtime AI transport and recording upload will each have independent failure and recovery boundaries. The focused [browser media spike](../../qa/recruitment/mediaSpike.md) found that Chromium `MediaRecorder` timeslice blobs are not each independently playable; actual Android Chrome and iOS Safari interruption/codec behavior remains to be verified before adding media-specific schema. No Guest AI device or session business contract is imported into Recruitment.
