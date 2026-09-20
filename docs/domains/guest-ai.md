# Guest AI

## Purpose And Scope

Guest AI is a self-contained bounded prototype module hosted inside the FeedX repository, Vercel deployment surface, and Supabase infrastructure for prototype validation.
It explores guest-facing AI interaction without coupling its lifecycle to Restaurant, Crew, or Factory business data.

## Canonical Ownership

The Guest AI-owned feature/workspace implementation, its technical Markdown, routes, permissions migration, Edge Functions, service contracts, and tests are authoritative.
This document owns Guest AI bounded-domain intent, integration limits, and FeedX worktree/Staging integration procedure. Guest AI technical Markdown owns firmware, device-protocol, session, and implementation detail.

## Core Boundaries

- Device boundary: a guest-facing client or device initiates and renders an interaction through the Guest AI workspace contracts.
- Protocol boundary: request, response, session, and event payloads use Guest AI-owned contracts and identifiers.
- Voice boundary: speech-to-text and text-to-speech are separate service capabilities from conversational reply generation.
- Provider boundary: external AI/voice providers are called server-side through Guest AI Edge Functions or services.
- Data boundary: prototype sessions, configuration, telemetry, and artifacts remain Guest AI-owned and minimize personal or FeedX-domain data.

## Lifecycle And Business Rules

The client captures permitted input, sends it through the relevant Guest AI service boundary, and renders canonical service results and errors.
Speech transcription, reply generation, and speech synthesis remain separable so providers or transports can change independently.
Provider credentials and privileged calls remain server-side.

Prototype data collection must be purposeful, minimal, and identifiable as Guest AI data.
Failures should degrade within the Guest AI experience and must not affect Restaurant, Crew, or Factory operations.
The module must not read or mutate established FeedX business-domain data without a future explicit integration contract.

## Permissions, Audit, And Privacy

Workspace access uses the current Guest AI module permissions and route contracts.
Server functions validate input, constrain provider use, and avoid exposing credentials or raw internal diagnostics.
Retain only the telemetry and artifacts needed for prototype validation, debugging, safety, and cost control under current contracts.
Do not infer broad guest identity, loyalty, ordering, or employee access authority.

## Admin, Developer, And Device Workflows

Authorized FeedX users access the Guest AI workspace and developer/validation surfaces defined by current routes.
Guest devices use Guest AI-owned protocols and safe service endpoints.
Operational FeedX users do not administer Restaurant, Crew, or Factory state through Guest AI.

### Development And FeedX Integration

Guest AI development is isolated in `/Users/deron/Dev/feedx-guest-ai` on its designated worktree and branch for independent development and commits. That branch must not overwrite, reset, replace, or force-push `dev`; `dev` remains FeedX's only canonical Staging integration branch.

When a scoped Guest AI milestone requires FeedX Staging under the global QA policy:

1. Fetch and inspect the latest `origin/dev`.
2. Integrate only the valid Guest AI changes into a clean, current `dev` worktree.
3. Preserve newer Restaurant, Crew, Factory, platform, and unrelated FeedX work.
4. Apply the risk-based QA policy in `FEEDX_CODEX_CONTEXT.md`, including relevant Guest AI and representative regression checks, the production build when warranted, and `git diff --check`.
5. Push current `dev` when required by the scoped task and selected QA level.
6. Use the canonical `fnb-system-staging` Git Integration deployment; never replace canonical Staging directly from the Guest AI branch.
7. Complete proportional authenticated Staging QA before reporting the milestone integrated.

Production deployment and merging `main` remain separately authorized under the global Context. The canonical `FEEDX_CODEX_CONTEXT.md` comes from `dev`; the Guest AI worktree must synchronize its latest rules rather than maintain divergent long-term governance.

## Integrations And Extraction Path

Current coupling should remain limited to repository hosting, platform shell/route registration, permission registration, Vercel, and Supabase infrastructure.
External AI, speech, or device providers are replaceable behind Guest AI service contracts.

If market validation succeeds, Guest AI should be extractable into an independently deployed product by moving its feature code, functions, migrations/data, secrets, and device contracts behind stable interfaces.
Avoid new foreign keys, shared tables, or business-service imports that make extraction dependent on FeedX operational domains.

## Compatibility And Deferred Scope

Legacy device-console aliases may resolve to the current canonical Guest AI owner without creating a second implementation.
Production ordering, payment, loyalty, CRM, restaurant operations control, and generalized consumer identity are deferred until separately designed and authorized.
