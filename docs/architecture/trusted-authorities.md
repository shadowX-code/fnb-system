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

The private `feedx_integrations.capabilities` registry owns business labels, workspace/module/resource, implementation availability, canonical Role Settings permission, transport binding, action and approval requirement. `view` means **View Records** and covers bounded List/Read/Search/Filter query operations. Draft/Execute/Approve remain distinct action types without executors in this phase. The fixed adapter manifest is the executor allowlist; registry rows never create executable code.

Registration creates one dedicated ordinary role and a one-time 30-day credential. Role Settings Create + Edit and canonical permission-delegation checks apply. Access changes require Edit, a dedicated role, canonical assignment authority, expected-state checks and the same role advisory lock as Role Settings. Module Select All/Clear uses the atomic `external_agents_set_capabilities` wrapper over that existing authority: any denial/stale grant rolls back the entire batch. Enable/disable preserves keys/grants. Keys remain expiring/revocable hashes; no employee impersonation or inferred organization ownership is used.

Gateway administration audit uses the existing audit log with server-controlled `trusted_external_agent` provenance. Authenticated clients cannot forge, edit or delete reserved `external_agent_*` / `external_machine_*` events or assert provenance. Earlier unverified management history is excluded. Resource telemetry remains service-only and records at most five registry-validated resource/operation pairs, without filters, search text, IDs, payloads or credentials. Administrator probes are distinguished from external requests; credential validity and a historical successful request do not prove a current Grok Bot connection.

### Factory resource authorization

`resources` defines Workspace → Module → Resource, filter fields, dependencies, relationship-field requirements, field policy and date semantics. Each resource has one `factory_agent_<slug>.view` Role Settings permission. `query_factory_resources` calls the anonymous-executable, machine-token-gated `factory_agent_resource_query`; private source helpers and tables have no client data grants. The reviewed inventory is `config/factoryAgentResources.json`; actual navigation coverage is `config/factoryAgentNavigation.json`. The database registry, explicit fixed SELECT cases and canonical domain read cores are runtime authority, never caller-controlled tables or SQL.

Every query and summary dependency is authorized before a batch reads data. Foreign relationship fields are omitted before predicates unless their resource is also authorized; hidden foreign-key filters are rejected. Nested Dashboard/Traceability projections require their complete explicit source resource set. No employee/health identities, customer/supplier contacts, actor payloads, notes, receipt files, feedback contact/answer payloads, public response tokens or arbitrary snapshots are exposed. Audit resources expose event classification/result/time only, not descriptions, actors or before/after data. Feedback exposes campaign/variant metadata and anonymous counts; business feedback insights and free text remain outside this read contract.

Dashboard analytics, Production Performance and Batch Traceability retain one calculator each: existing public human APIs delegate to private shared invoker cores. Human calls retain original permission checks and source RLS; the Gateway's bounded definer wrapper validates machine resource permissions before calling those same cores with a token. It does not set a staff JWT or alter human permission helpers. Authenticated schema usage permits only the explicitly granted invoker cores; private tables and elevated source helpers remain inaccessible. Persisted-record resources project the same authoritative records consumed by `factoryService`, without recreating lifecycles or balances.

Bounds: 1–5 queries/request; 31 Malaysia dates/query; 1–100 records/page; 5,000 source rows/window (fail closed above the bound); 512 KiB/response. Cursors are bound to the normalized resource/operation/window/filter/page-size query and reauthorize every page. Reads are live, not a frozen multi-request snapshot. Search matches safe labels literally; filters use whitelisted string equality. Master data is a current snapshot; Dashboard/Performance preserve full month/trend/live-stock semantics. Ordinary records use canonical business dates, with completed Production attributed to Production End. Undated records are excluded explicitly. Empty results do not certify completeness or compliance.

### Compatibility migration

A role with all four old MeSTI operation grants can migrate to the equivalent View Records grant; partial old operations are preserved only as a restricted compatibility path and are not promoted. A role with all five legacy review grants migrates to `factory_agent_mesti_review.view`, backed by the unchanged `mesti_rows` projection. Its former five grants are removed, with a trusted migration audit, and its credential is unchanged. This migration grants no raw MeSTI, Production or Warehouse resource access.

The five review tool names and `query_mesti_resources` remain thin transport adapters over shared authorities. A Compliance Review Records grant authorizes exactly the previous five-tool data scope. Their technical identifiers are absent from normal permission selection. Existing partial legacy tool grants retain their prior endpoint behavior but cannot be newly assigned through the Gateway management UI. Final retirement requires equivalent resource behavior **and actual provider-side confirmation in the existing Grok Bot**. Independent MCP HTTP success does not establish that confirmation. No second MeSTI review calculator, mutation tool, generic write or approval workflow is introduced.
