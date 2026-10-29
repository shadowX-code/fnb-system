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

An adapter must enforce its own fixed capability allowlist and redacted read projection after `feedx_integrations.authorize`. Machine role grants do not create a Supabase JWT, table grants or access to other RPCs. The retained `factory_mesti_inspection.view` code is the connection prerequisite; explicit navigation-module grants or preserved legacy grants authorize the bounded read tools. The Edge Function uses its internal anonymous key for token-gated business read RPCs, not a service-role key; no Supabase credential is sent to an external agent. Role permission removal, role/identity disabling and credential revocation deny subsequent reads. Credentials expire after at most 90 days; the initial Staging QA credential has a 30-day lifetime. Renewal is explicit and may revoke the previous credential without changing identity or role. Identity/credential administration automatically appends safe before/after metadata to the canonical audit log, including revocation and credential replacement, with server-derived actor/time and no token or hash. MCP reads append bounded security access telemetry, never business evidence. No organization/company tenancy is inferred by this foundation.

The private `feedx_integrations.capabilities` registry owns business labels, workspace/module/resource, implementation availability, canonical Role Settings permission, transport binding, action and approval requirement. `view` means **View Records** and covers bounded List/Read/Search/Filter query operations. Draft/Execute/Approve remain distinct action types without executors in this phase. The fixed adapter manifest is the executor allowlist; registry rows never create executable code.

Registration creates one dedicated ordinary role and a one-time 30-day credential. Role Settings Create + Edit and canonical permission-delegation checks apply. Access changes require Edit, a dedicated role, canonical assignment authority, expected-state checks and the same role advisory lock as Role Settings. Module Select All/Clear uses the atomic `external_agents_set_capabilities` wrapper over that existing authority: any denial/stale grant rolls back the entire batch. Enable/disable preserves keys/grants. Keys remain expiring/revocable hashes; no employee impersonation or inferred organization ownership is used.

Gateway administration audit uses the existing audit log with server-controlled `trusted_external_agent` provenance. Authenticated clients cannot forge, edit or delete reserved `external_agent_*` / `external_machine_*` events or assert provenance. Earlier unverified management history is excluded. Resource telemetry remains service-only and records at most five registry-validated resource/operation pairs, without filters, search text, IDs, payloads or credentials. Administrator probes are distinguished from external requests; credential validity and a historical successful request do not prove a current Grok Bot connection.

### Factory navigation authorization

Agent administration uses **Workspace → Navigation Section → Business Module → View Records**. `config/factoryAgentModules.json` is the reviewed navigation/policy catalog: all 34 Factory business routes, the exact six sidebar sections, labels and order, and the two hidden related routes. `config/factoryAgentNavigation.json` is its route-to-resource mapping. The 65 `resources` reuse domain-owned shared RPC cores and the saved read sources used by `factoryService`; no business lifecycle authority is duplicated.

Private `navigation_modules` stores route identity, business label, section, sidebar visibility, Available/Limited/Unavailable capability coverage and an explicit explanation. `navigation_resources` maps modules to existing resource keys with an optional forced row scope, safe field allowlist, relationship-module gates and required source modules. These are authorization/projection policies, never a parallel business data store. Each selectable module has one `factory_agent_nav_<module_id>.view` canonical Role Settings grant, bound to `query_factory_resources`. Production Reports is Partial and exposes saved source datasets only with their owning module grants. UI-calculated costing/yield totals are not duplicated or replaced by a different route's monthly performance.

New queries must carry their granted `business_module`. The server checks the module/resource pair and all summary source modules before any batch reads data. Shared MeSTI projections are filtered to that exact module before bounds, redaction, predicates or paging; conflicting scopes are rejected. Generic resource grants are never inferred from a module grant. Module-only agents cannot omit scope or use the legacy resource/review endpoints to inspect other modules. Resource IDs, table names, SQL, joins, expansions and action mutations are not administrator permission controls or unrestricted query authority.

The server applies the module's explicit field policy and removes ungranted foreign references before filtering or literal label search. Hidden-field predicates are rejected. Shared MeSTI composite IDs become stable module-scoped references, with same-module parent references preserved; source UUIDs embedded in cross-domain IDs are not exposed accidentally. Canonical statuses, effective versions, recurrence, current-state evidence and Production End dates still come from the existing domain sources. Health is daily aggregate only; Hygiene is session aggregate only. No individual health/employee data, contacts, actors, receipt paths, feedback answers/tokens, free-text notes or arbitrary snapshots are added.

Dashboard, monthly Production Overview and Batch Traceability expose only their declared partial read contract and require explicit grants for all contributing modules. Canonical reporting/traceability calculators remain the shared invoker cores used by existing human APIs. Human source RLS and employee authority are unchanged. Audit Trail returns redacted classifications/outcomes/times only for separately granted, recognized module owners; personal health/hygiene and unclassified events are omitted. The safe audit projection is shared by legacy and module-aware readers.

The shared Admin `ModuleAccessSelector` is used by Connect Agent and Manage Access. It groups exactly by sidebar section, shows module coverage/reasons, distinguishes related routes, and provides atomic Select All/Clear without implicitly selecting dependencies or unavailable modules. Technical resource IDs and permission keys appear only under Advanced Details. Ordinary role editing hides obsolete resource toggles while retaining their definitions for existing saved roles. The canonical `save_role_configuration` authority rejects adding a new legacy resource/tool scope or an unavailable module to an existing machine role. Existing grants may be retained or removed; the Gateway's own registration and grant authority issues only implemented navigation-module grants.

Bounds remain five queries, 31 Malaysia dates, 1–100 records/page, 5,000 authorized source rows/window and 512 KiB/response. Keyset cursors bind the normalized module/resource/operation/window/filter/page-size query; each page reauthorizes. Master data is current, monthly reports retain canonical month/trend/live-stock context, and undated records are not given invented dates. Empty data is not compliance or completeness. Module-scoped telemetry records only validated module/resource/operation names, never request filters, search text, IDs, results or credentials.

### Compatibility migration

The earlier resource rollout migrated complete four-operation MeSTI bundles to equivalent resource grants; those stored scopes and partial operation grants remain restricted compatibility paths. The navigation rollout does not promote them to module grants. A role with all five legacy review grants migrates to `factory_agent_mesti_review.view`, backed by the unchanged `mesti_rows` projection. Its former five grants are removed, with a trusted migration audit, and its credential is unchanged. This migration grants no raw MeSTI, Production or Warehouse resource access.

The five review tool names and `query_mesti_resources` are retired following confirmed full replacement workflow execution by the existing Grok Bot. The public inspection/resource compatibility RPCs and five unassigned tool permissions are removed. `factory_agent_authorize` uses the unchanged connection prerequisite and machine authority; discovery exposes only `query_factory_resources`. Existing resource grants, shared projections and audit history are preserved. No broader grants are inferred.

No current machine grant was automatically migrated in the navigation rollout. QA Executive’s existing Compliance Review Records permission covers a narrower eight-module MeSTI review projection than the new full module read contracts. Its original role, key, expiry, grants and resource connectivity remain intact. The catalog marks those eight modules as having **preserved restricted access**, independently of the new View Records checkbox. Clearing new module grants does not erase that preserved scope; explicit removal is available under Advanced Details with confirmation. Preservation indicators are metadata derived from actual canonical grants, never an additional authorization store.

### Gateway read-coverage completion

The Food Processing and Finished Product Storage RPCs, production pipeline snapshot and open-order aggregate delegate to one shared core each. Public human signatures, permission checks, grants and security mode are preserved. Private cores accept either the existing human gate with a null Gateway token, or the narrowly declared navigation grant with a validated machine token; anonymous callers cannot invoke them directly. The Gateway calls only the read snapshot, never the UI loader’s due-release mutation. Its projection removes staff, notes and nested related objects before filters/pagination. Missing pinned SOPs or missing/ambiguous batch evidence are explicitly unavailable.

Navigation discovery derives executable operations from the same canonical role grants and required source modules; unsupported dependency combinations remain visible only as metadata with missing-grant explanations. Field/filter discovery omits foreign references without their owning module. New saved-record resources cover stock adjustment allocations, QC checkpoints, SOP substeps/QC/material/equipment bindings, categories, tags, supplier eligibility and receiving cost inputs. No identity, key or existing QA Executive grant is rewritten. The review resource retains its canonical inspection projection after provider-confirmed retirement of transport aliases.

Raw Material Control likewise shares the existing active-standard and completed-receiving RPC bodies with Admin through private cores. Human gates and grants are unchanged; its Gateway projection excludes draft/cancelled documents, actors, costs and ungranted foreign identities. Cleaning Method enrichment reads only versioned requirements or issued snapshots, with a nested reference-key allowlist. Missing legacy methods are unavailable; read paths never materialize occurrences or substitute current methods.

### Capability coverage and agent access

Navigation metadata separates capability coverage (`available`, `limited`, `unavailable`) from the canonical saved grant. Limited means an existing supported module read feature is missing from the Gateway; it never means insufficient Staging data, privacy redaction, historical missingness or a required source grant. `capability_limitation` records genuine missing features; `data_limitations` carries contextual scope/history notes. Both Connect Agent and Manage Access use the same compact selector with expandable Access details. Coverage changes do not change mappings, authorization, saved grants or credentials. See `../testing/factory-agent-module-coverage.md` for the 34-module assessment.
