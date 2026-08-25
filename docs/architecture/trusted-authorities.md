# Trusted Authorities

## Scope

This document owns FeedX-wide security and server-authority principles.
Domain documents identify which lifecycles use those principles without duplicating implementation details.

## Server Authority

Protected calculations and multi-write transitions execute in trusted database functions or Edge Functions.
Clients submit intent, display previews where useful, and refresh canonical read models from server results.
The server derives actors, validates state transitions, enforces scope, calculates protected values, and writes audit evidence.

Direct table CRUD is appropriate only where current RLS and domain contracts explicitly define it as the canonical mutation path.
Do not bypass an established lifecycle authority or add a parallel writer.
Retryable commands should use request identity and payload fingerprinting when supported.

## Row-Level Security

RLS is mandatory for exposed business tables.
Policies must align with the actual caller model:

- Admin access uses authenticated identity, permission, and outlet or record scope.
- Crew access uses validated opaque session tokens through token-bound authorities.
- Service-role use is limited to deliberately trusted server execution.

UI permission checks improve usability but do not replace RLS or in-authority validation.
Read policies must avoid leaking records, identities, private content, or cross-outlet state.

## Security Definer Functions And Grants

Every `SECURITY DEFINER` authority must use a controlled `search_path` and schema-qualified objects where appropriate.
It must validate caller identity, permission, scope, state, and input before mutation.
Actor identity and trusted timestamps must be server-derived.

PostgreSQL grants are explicit:

- revoke default execution from `PUBLIC`;
- grant only to intended roles;
- keep internal helper functions non-executable by clients;
- avoid granting broad table writes that bypass the authority.

## Crew Token-Bound Authority

Crew access is separate from Admin Auth.
Opaque Crew tokens may cross an anonymous or authenticated transport boundary only into functions that validate the token and return the minimum safe payload.
Sensitive functions must recheck session expiry, Crew Access state, employee lifecycle eligibility, and record ownership.
Reset, disable, or security-sensitive changes should revoke prior sessions as defined by the domain.

Do not expose token hashes, passcode hashes, internal security state, or unrelated employee records.

## Admin Permission And Outlet Scope

Admin mutations require both the relevant permission and access to every affected outlet or record.
Where an operation spans an employee's home outlet and an operational outlet, validate every required scope explicitly.
Never trust a client-supplied actor, role, permission, or ownership field.

Employee role assignment and employee/Auth linkage use their canonical controlled paths.
Role configuration changes use the established trusted save authority.

## Immutable Evidence And Versions

Finalized business evidence is append-only or changed through an explicit reversal, correction, superseding version, or controlled reopen lifecycle.
Published content and schedules pin the versions consumed by downstream activity.
Historical snapshots preserve meaning when master data or rules later change.

Examples include financial period snapshots, roster publication revisions, SOP and learning versions, localized snapshots, performance evidence, stock and cash ledgers, and production traceability records.
The exact state model remains owned by each domain document and current contracts.

## Audit Discipline

Audit meaningful business and security actions, including protected state transitions, authority changes, immutable adjustments, and controlled reversals.
Store server-derived actor and time, relevant scope, prior/new state or reason where appropriate, and stable references to affected records.
Avoid recording secrets or unnecessary personal data.
Routine reads and cosmetic UI activity are not business audit events.

## Change Rules

Update this document when FeedX-wide authority, RLS, grant, token, audit, versioning, snapshot, or immutability principles change.
Document domain-specific permissions and lifecycle details in the owning domain document.
