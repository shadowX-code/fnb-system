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

Recruitment invitation tokens follow the public token authority pattern: only a random token hash is persisted, all Recruitment tables have RLS with direct anonymous/client table grants revoked, and narrow public RPCs revalidate token expiry, revocation, and opening state on every operation. Versioned candidate consent and Ready transitions are written server-side; a public hostname is never an authorization grant. See the People Recruitment domain contract.
Policies must align with the actual caller model:

- Admin access uses authenticated identity, permission, and outlet or record scope.
- Crew access uses validated opaque session tokens through token-bound authorities.
- Service-role use is limited to deliberately trusted server execution.

UI permission checks improve usability but do not replace RLS or in-authority validation.
Read policies must avoid leaking records, identities, private content, or cross-outlet state.

Platform's shared role, permission and outlet helpers own authorization execution cost as well as semantics. Their PL/pgSQL static queries reuse prepared execution plans; this is not a cache of role/permission results or a client/JWT authority replacement. Current Employee precedence, disabled-access denial, legacy-only fallback, permission aliases and outlet scope must remain unchanged. Verify complete authenticated read sets and allow/deny cases when optimizing these helpers; never remove RLS or completeness checks to improve latency.

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

### Crew Asset Presentation Details

`Manage Asset Details` is an independent Crew Special Access capability. Its
token-bound authority may change only an active outlet Asset's name,
description, location, and master-photo references. It cannot mutate quantity,
condition, category, maintenance, archival, or disposal. Photo variants are
written by the trusted `crew-asset-details` Edge Function and finalized through
the same request-id lifecycle/audit pattern as other Asset mutations.

## Admin Permission And Outlet Scope

Admin mutations require both the relevant permission and access to every affected outlet or record.
Where an operation spans an employee's home outlet and an operational outlet, validate every required scope explicitly.
Never trust a client-supplied actor, role, permission, or ownership field.

Employee role assignment and employee/Auth linkage use their canonical controlled paths.
Role configuration changes use the established trusted save authority.

Marketing adds explicit organization membership and role brand scope to the canonical Admin identity/action checks. Its business tables are RPC-only with direct browser grants revoked; private media is prepared and finalized through the same brand authority. Publishing claims/completions are service-only and revalidate the approving authorizer and pinned revision. See `../domains/marketing.md`.

## Immutable Evidence And Versions

Expected business revision conflicts exposed through PostgREST must use a non-retryable application error such as `PT409` (HTTP 409), not PostgreSQL engine serialization failure `40001`. The conflict still rejects the stale intent; callers reload and review canonical state rather than automatically resubmitting it. This distinction prevents transport-level transaction retry loops without weakening version checks.

Finalized business evidence is append-only or changed through an explicit reversal, correction, superseding version, or controlled reopen lifecycle.
Published content and schedules pin the versions consumed by downstream activity.
Historical snapshots preserve meaning when master data or rules later change.

Examples include financial period snapshots, roster publication revisions, SOP and learning versions, localized snapshots, performance evidence, stock and cash ledgers, and production traceability records.
Food Handling Compliance follows the same rule: evidence submissions and review decisions are append-only, replacements supersede only after verification, and private historical evidence is never overwritten by resubmission.
Employment Documents also follow this rule: Draft PDF evidence is replaceable, but Send pins the exact private object and server-calculated SHA-256 together with employee, legal-employer, issuer, and consent snapshots. V2 template contracts additionally pin the immutable published template version, contract-term snapshot, and canonical render-manifest hash. The server regenerates that manifest at Send and rejects a stale preview, so the server-rendered preview bytes are the bytes whose hash enters the existing immutable document authority. Viewed/Completed events are token-bound and append-only; withdrawal or supersession never edits the sent version.
The exact state model remains owned by each domain document and current contracts.

## Audit Discipline

Audit meaningful business and security actions, including protected state transitions, authority changes, immutable adjustments, and controlled reversals.
Store server-derived actor and time, relevant scope, prior/new state or reason where appropriate, and stable references to affected records.
Avoid recording secrets or unnecessary personal data.
Routine reads and cosmetic UI activity are not business audit events.

## Change Rules

### FeedX External Agent Gateway

`feedx_integrations.machine_identities` and `machine_credentials` are the shared FeedX External Agent Gateway identity and credential authority. Both are private, RLS-enabled server-only tables. A machine references an ordinary canonical Role Settings role, never an Employee or a fabricated Auth user. The database validates an opaque 256-bit credential's SHA-256 hash, activation time, expiry, revocation, enabled identity, active non-protected role and explicit permission grant on every request. Protected Owner/Admin bypass is intentionally unavailable to machines. Plaintext credentials are never persisted in the database, repository, logs or audit metadata. Identity registration remains a privileged operator action; no machine can create identities, issue credentials or edit roles.

An adapter must enforce its own fixed capability allowlist and redacted read projection after `feedx_integrations.authorize`. Machine role grants do not create a Supabase JWT, table grants or access to other RPCs. The first adapter is `factory_mesti_inspection.view`, limited to five read-only MeSTI tools. The Edge Function uses its internal anonymous key to invoke that one token-gated RPC, not a service-role key; no Supabase credential is sent to an external agent. Role permission removal, role/identity disabling and credential revocation deny subsequent reads. Credentials expire after at most 90 days; the initial Staging QA credential has a 30-day lifetime. Renewal is explicit and may revoke the previous credential without changing identity or role. Identity/credential administration automatically appends safe before/after metadata to the canonical audit log, including revocation and credential replacement, with server-derived actor/time and no token or hash. Ordinary reads emit no audit writes. No organization/company tenancy is inferred by this foundation.

The private `feedx_integrations.capabilities` registry owns each tool’s business label, workspace/module, action (`read`, `draft`, `execute`, `approve`), implementation availability, canonical permission and explicit human-approval requirement. The adapter manifest remains a fixed executor allowlist. Registration alone cannot enable an executor or bypass domain authority. Only the five MeSTI Read capabilities are implemented. Each has its own `factory_mesti_inspection_<status|exceptions|verifications|evidence|schedule>.view` Role Settings grant, in addition to the `factory_mesti_inspection.view` connection prerequisite. The migration carries forward those same five reads from existing bundle grants; it does not change existing credentials or effective data access. The database checks the tool grant before projection, and authenticated MCP discovery exposes only granted implemented tools. A cached tool list never authorizes a later call.

`external_agents_register` requires canonical Role Settings Create and Edit plus delegation of every selected permission. It creates an ordinary dedicated role through `save_role_configuration`, a machine identity and a 30-day one-time key in one transaction. A registration request cannot be replayed to retrieve a key. The client cannot submit a role, endpoint, permission code, action type or ownership boundary. `external_agents_set_enabled` pauses/resumes the same identity without changing keys or grants. Disabled identities cannot authenticate; replacing a disabled identity’s key does not enable it.

`external_agents_set_capability` is the bounded machine-grant operation owned by Role Settings. It writes the existing `role_permissions` store, uses the canonical role-configuration advisory lock and delegation/editability checks, locks the identity and role, and verifies the expected grant state. It accepts only an implemented registry tool on the target adapter’s fixed allowlist. Shared employee/profile/machine roles must be managed in Role Settings, avoiding unintended changes through a single-agent screen. Changes append server-derived actor/time and before/after grant evidence to canonical `audit_logs`. No alternative machine grant store or authorization bypass exists. The registry-driven management UI groups Workspace → Module → Capability, renders action-specific permissions and human-approval metadata, and marks unsupported actions/modules unavailable. Future tools still require their own domain implementation and sensitive-action approval authority; none are implemented here.

Admin Settings → Integrations → External Agents consumes `external_agents_admin_data` with business-facing Overview, Access & Permissions and Activity tabs and existing Role Settings View authority (including the legacy alias). Management reuses Role Settings Edit, `role_is_editable_by_current_user` and permission delegation checks against the target machine's role. Revocation is idempotent and identity-bound. Rotation locks the identity and role, checks the expected current credential and a unique request ID, atomically revokes previous credentials, generates 256 random bits server-side and stores only the hash. Only the dedicated one-time issuance response returns the new credential; ordinary connection, history and access APIs never return a credential or hash. Issuance cannot be replayed to retrieve the secret. Lost responses require explicit review/refresh and another rotation. The UI holds issuance only in component memory, masked by default, and clears it on close, hidden tab, authorization loss or after two minutes; there is no persisted secret store or automatic retry.

`access_events` is bounded, server-timestamped connection telemetry, separate from business evidence and security-administration audit. Only a service-only RPC may append observations. The MCP handler records allowed method/tool names, success/denial/failure and fixed reason codes; it never logs request arguments, evidence, raw errors, tokens or hashes. The connector's service-role client is restricted in code to this telemetry RPC; business reads continue through the original machine-token/anonymous client. Unknown credentials cannot be attributed to an identity and are not exposed as an invented agent event. Missing earlier history is explicit. Admin probes use a short-lived, token-bound HMAC proof to remain distinct from external requests; neither reachability checks nor Admin credential tests establish an external provider connection. A successful external MCP observation remains historical evidence, not a live-session or Grok-provider guarantee.

Update this document when FeedX-wide authority, RLS, grant, token, audit, versioning, snapshot, or immutability principles change.
Document domain-specific permissions and lifecycle details in the owning domain document.

## Platform Member Brand Access

`platform_team_brand_access` is a scoped team projection, not a second permission catalog. `platform_member_brand_access` derives the active canonical employee, requires existing Platform management/Marketing configuration authority, validates tenant membership and the caller’s complete scope, locks membership/employee/scope, checks the expected revision and exact retry fingerprint, and appends before/after audit evidence. Self scope and protected Owner/Admin scope cannot be edited. Scope tables have RLS and no anonymous/authenticated direct grants; clients use the trusted RPCs only. The legacy Role-scope command is denied after compatible migration; existing evidence remains. Private Platform scope helpers are consumed by existing Marketing RLS/read authorities and executor/assignee/provider guards. Uncertain external outcomes remain reconciliation work; revocation never authorizes another external attempt.
