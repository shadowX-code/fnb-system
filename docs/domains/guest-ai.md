# Guest AI

## Purpose And Scope

Guest AI is a self-contained bounded prototype module hosted inside the FeedX repository, Vercel deployment surface, and Supabase infrastructure for prototype validation.
It explores guest-facing AI interaction without coupling its lifecycle to Restaurant, Crew, or Factory business data.

## Canonical Ownership

The Guest AI-owned feature/workspace implementation, its technical Markdown, routes, permissions migration, Edge Functions, service contracts, and tests are authoritative.
This FeedX-side document owns bounded-domain intent and integration limits; Guest AI-owned documentation owns firmware, device-protocol, session, branch, and detailed Staging implementation procedures.

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

## Integrations And Extraction Path

Current coupling should remain limited to repository hosting, platform shell/route registration, permission registration, Vercel, and Supabase infrastructure.
External AI, speech, or device providers are replaceable behind Guest AI service contracts.

If market validation succeeds, Guest AI should be extractable into an independently deployed product by moving its feature code, functions, migrations/data, secrets, and device contracts behind stable interfaces.
Avoid new foreign keys, shared tables, or business-service imports that make extraction dependent on FeedX operational domains.

## Compatibility And Deferred Scope

Legacy device-console aliases may resolve to the current canonical Guest AI owner without creating a second implementation.
Production ordering, payment, loyalty, CRM, restaurant operations control, and generalized consumer identity are deferred until separately designed and authorized.
