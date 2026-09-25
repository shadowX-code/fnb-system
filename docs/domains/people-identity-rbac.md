# People, Identity, And RBAC

## Purpose And Scope

This domain owns the employee master record, Admin authentication linkage, role assignment, permissions, outlet scope, and the security relationships consumed by every FeedX workspace.
It does not own Crew passcode/session lifecycle, which belongs to Crew Workforce.

## Canonical Ownership

Current employee, role, permission, Auth-link, role-configuration, RLS, and audit contracts are authoritative.
`employees.role_id` is the canonical employee-role assignment.
`employees.auth_user_id` is the canonical employee-to-Supabase-Auth link.
`employees.profile_photo_path` is the canonical reference for an employee profile photo; the image itself is private Crew presentation data, not a second employee profile.

## Core Entities

- Employee master records and employment state
- Supabase Auth users linked to employees
- Roles, permissions, module capabilities, and role configuration
- Outlet access and other explicit scope relationships
- Admin access state and security-relevant audit events
- Requirement-driven employee compliance, immutable evidence submissions, reviews, expiry state, and history
- Employee disciplinary warning drafts, immutable issued records, delivery/view/acknowledgement evidence, employee responses, and correction history
- Legal employing entities, employee legal-employer assignment, and immutable Employment Contract acknowledgement records

## Lifecycle And Business Rules

Employee identity, job position, role, Admin access, and Crew Access are distinct concepts.
Editing an employee must not silently replace role or Auth linkage.
Role configuration is saved through the established trusted authority so permission replacement is atomic and auditable.
Employment-state changes must be respected by downstream Admin and Crew authorities.
The Employee Master Workplace is the canonical workforce-belonging relationship. Restaurant outlet names remain valid workplaces for Restaurant employees; `Factory` and `Management` are canonical non-outlet values. Crew Workforce may mirror a resolved Restaurant outlet for credentials, but does not own a competing employee-outlet mapping; an Employee Master workplace change is the authoritative transfer event. Factory staff/operator selectors use one shared eligibility source: active employees whose Workplace is exactly `Factory`. Management employees with Factory permissions retain their permitted Factory authority but are not Factory workforce; Factory workplace without a Factory permission likewise grants no Factory system authority. Historical actor/provenance evidence is unchanged.

Role permissions grant module/action authority. `roles.outlet_access_type` and `role_outlets` scope Restaurant data only: a role with one or more Restaurant-scoped permissions must use All or Selected Outlets, while a role with no Restaurant-scoped permission has explicit `none` Restaurant outlet scope and no `role_outlets` rows. Factory, Crew, People, System, and Guest authority never depends on Restaurant outlet scope; FeedX does not create a Factory Access, All Factories, or workspace-scope parallel model. The canonical permission catalog marks whether each permission requires Restaurant outlet scope, and the trusted role-save authority derives and validates the applicable mode server-side.

The module registry defines available capabilities; roles grant permission to them but do not redefine route ownership.
UI gating mirrors authority for usability while RLS and trusted functions enforce access.

## Permissions And Audit

Only authorized Admins may manage employee, role, access, or scope relationships.
All affected outlet and record scopes must be validated.
Security-sensitive changes derive actor identity server-side and retain meaningful audit evidence.
Secrets, password material, passcode hashes, and tokens are never exposed in employee payloads or audit details.
Crew may update only the profile-photo object path derived for the employee resolved from its current opaque token. The private Storage object is read through the approved server boundary using a short-lived signed URL; neither employee ID nor arbitrary Storage path is accepted from Crew clients.

## Food Handling Compliance V1

People owns the user-facing Food Handling Compliance capability. V1 has exactly two seeded requirements: Food Handler Certificate (one photo, no expiry) and Typhoid Injection (one photo with required expiry). Requirements apply to every active employee; there are no exemptions, position/outlet policies, or downstream eligibility effects. Platform may deliver a normal expiring-soon or important expired notification from the server-derived effective state; this does not change Food Handling Compliance ownership, action state, or verification authority. Internal `employee_compliance` contracts retain their established identifiers.

Submissions are immutable and retain an outlet snapshot. Reviews are append-only, require the dedicated `employee_compliance.review` permission, enforce the employee's current outlet scope, and require a reason when rejected. Crew identity is always derived from the opaque Crew session token and Crew can never verify its own evidence.

Current state is a server-derived projection. A verified record is `Expiring Soon` within 30 days of expiry and `Expired` after expiry using the Malaysia business date. A pending replacement does not displace the latest verified record; it becomes effective only when verified. Rejected, superseded, and former-employee history remains private and retained.

Compliance evidence uses the private `employee-compliance-evidence` bucket with immutable versioned paths. Crew and authorized Admins receive only short-lived signed reads through the dedicated evidence authority. Compliance does not affect Performance, Reward, Attendance, Duty Roster, or Crew Special Access.

## Employee Disciplinary Records V1

People owns employee warnings and disciplinary records. New V1 records support Written Warning and Final Written Warning; historical First Written Warning values remain immutable and retain their exact issued label. Warning level is selected by an authorized Admin and is never escalated automatically from warning count. This is not a generic investigation, Show Cause, outcome, dismissal, or penalty engine. Draft warning content is editable by an Admin with `employee_disciplinary.manage` within the employee's current outlet scope. Issuance pins the employee, outlet snapshot, warning type, incident and issued dates, subject, details, required action, issuer, optional related previous warning, and optional private evidence. Issued content cannot be edited.

The canonical lifecycle is Draft, Issued, Delivered, Viewed, and Acknowledged, with controlled Not Acknowledged, Withdrawn, and Superseded outcomes. Crew list delivery records server-derived delivery evidence; opening detail records the first view; acknowledgement records receipt only and is not agreement, admission, or confirmation of misconduct. An optional employee response is append-only and does not alter the warning. If acknowledgement never occurs, Delivery and first View evidence remain authoritative.

The canonical Crew disciplinary projection returns a server-derived unread count for Delivered records without `first_viewed_at`. Crew Me may display this count, but merely loading Me or the warning list does not clear it. Opening warning detail records the first view and removes the warning from the next unread projection; acknowledgement remains a separate lifecycle action. Withdrawn and superseded history is never counted as unread.

Each issued warning receives a server-derived, employee-scoped chronological display sequence (`Warning #N`). Sequence communicates history order only, not severity. The number is assigned atomically at issue time and is never renumbered when a record is withdrawn or superseded. A draft may optionally reference one of the employee's prior issued warnings to document related or repeated conduct; this relationship does not constrain the selected warning level.

Corrections never rewrite an issued record. Admins withdraw with a reason or issue a new warning linked as a superseding record; the original content, sequence, relationships, evidence, response, and chronological activity remain private history. Dedicated `employee_disciplinary.view` and `employee_disciplinary.manage` permissions are separate from general employee edit authority. Crew identity is derived only from its opaque session token and Crew can access only its own non-draft records.

Supporting evidence uses the private `employee-disciplinary-evidence` bucket with immutable object paths and short-lived authorized reads. Issuing a warning may create an important Platform notification for an active Crew recipient; reading that notification is not delivery, view, acknowledgement, or admission evidence. Disciplinary records do not affect Performance, Reward, Attendance, Duty Roster, payroll, Tasks, or Crew Access. A future Incident / Show Cause / Response / Review / Outcome model may reference a warning as one possible outcome, but is deliberately outside V1.

## Legal Employers And Employment Documents

People owns Legal Entities as a standalone legal-employer master-data module, with separate `legal_entities.view` and `legal_entities.manage` authority. A Legal Entity records legal company name, registration number, registered address, optional display name, active state, and a read-only linked-employee count. `employees.legal_entity_id` is the canonical current assignment; it is separate from Workplace/Outlet, which remains operational location. Deactivation preserves existing employee relationships and immutable document snapshots, while preventing future assignment or contract sending. Legacy employees may remain unassigned, but an Employment Contract cannot be sent until an active Legal Entity is assigned.

V1 supports uploaded Employment Contract PDFs only, with a 10 MB limit and no template/builder. Draft metadata and PDF may be edited. Send atomically snapshots employee employment metadata, the exact legal-employer identity/address, issuer identity, consent copy/version/hash, PDF path/size, and server-calculated SHA-256. Sent content is immutable. The lifecycle is Draft, Sent, Viewed, and Completed, with reasoned Withdrawal and version-linked Supersession. Corrections create a new version; they never rewrite sent or completed evidence.

Completion is an employment-document acknowledgement, not a FeedX claim of legal electronic-signature status. Crew identity is derived only from the current opaque Crew session. Opening the exact private PDF records first view once; acknowledgement stores a retry-safe request identity and append-only event containing the pinned PDF and consent evidence. Dedicated `employee_employment_documents.view` and `.manage` permissions enforce People authority and employee outlet scope.

PDFs use the private `employee-employment-documents` bucket. Ordinary clients have no direct object authority; a dedicated server boundary validates Admin or Crew scope and returns five-minute signed view/download URLs. Completed, withdrawn, and superseded history remains immutable. V1 has no outlet-wide overview, former-employee access, payroll, Performance, Reward, Attendance, roster, or Crew Access effects.

### Employment Contract Builder V2

V2 adds Legal-Entity-owned Employment Contract templates without replacing the V1 document lifecycle. Templates are English Full-Time or Part-Time contract templates. A template may have many immutable published versions and one optional default per Legal Entity, contract type, and language. Template clauses are ordered plain text and may use only the server-approved merge-variable allowlist; they do not accept HTML, conditions, loops, AI-generated clauses, or general document-builder expressions.

Employment Agreement V1 is a reusable Malaysian Full-Time template starting point within that same authority, not a separate contract product. It provides clauses and renderer blocks for annual leave, sick and hospitalisation leave, and signatures. It uses canonical Legal Entity identity and Employee identity; `employees.residential_address` is optional People master data and is included in the immutable template render manifest when present. Contract date, notice periods, signatory details, salary and allowances remain contract-owned terms. The standard agreement's published wording must remain subject to applicable Malaysian law and mandatory minima; it is not legal advice or an electronic-signature claim.

The Legal Entity Contract Workspace owns both template authoring and generated employee-contract creation. An authorized Admin begins from an active published Legal-Entity template, selects an employee already assigned to that Legal Entity, confirms contract-owned terms, reviews the exact server-generated PDF, and then sends it through the existing Employment Documents authority. Employee Profile is a history/status consumer for resulting documents; it does not offer generated-contract creation. Existing-PDF upload remains a separate import-only path. Employee legal name/code and legal employer are prefetched from People; Legal Employer cannot be overridden. Position, workplace, employment type, and commencement date can be explicitly overridden only inside the contract context and never write back to Employee, payroll, roster, or other authorities. Salary, allowances, working arrangements, notice, effective date, and additional terms are contract-owned structured data.

The database builds a canonical render manifest from the exact template version, current employee/legal-employer values, and terms. The dedicated Employment Documents Edge Function renders that manifest to a private PDF and records its SHA-256. Send recomputes the manifest and refuses a stale preview; it snapshots the terms and template version alongside the existing V1 PDF, employee, employer, issuer, consent, and lifecycle evidence. Generated and uploaded contracts therefore share the same Draft → Sent → Viewed → Completed acknowledgement lifecycle and Crew Contracts & Letters consumer. V2 remains an acknowledgement workflow, not a claim of electronic-signature status.

The Legal Entity Contract Workspace is the only Admin authoring surface for Legal-Entity-owned templates and generated employee contracts. Template Authoring presents compact version-aware clause editing beside a responsive transient A4 preview, with narrow screens switching structurally between Editor and Preview. It uses only the server-approved token picker and preserves draft/published version semantics. Its template preview is a read-only, permission- and employee-scope-checked use of the same Employment Documents server PDF renderer: it receives only an active employee linked to the selected Legal Entity, returns in-memory PDF bytes, canonical page count, and missing-token indicators, and never publishes a template, creates an Employment Document, writes Storage, or records an audit event. The separate Create Employee Contract flow selects the scoped employee, snapshots confirmed terms into the existing generated-document draft, renders the exact server PDF, and sends through the existing lifecycle; it never mutates Employee, Payroll, Roster, or published template versions.

## Workflows And Integrations

Admins create and maintain employees, link eligible Admin identities through controlled workflows, assign roles, configure permissions, and manage scope.
Crew Workforce consumes employee eligibility and maintains a separate Crew access extension.
All Restaurant, Crew, and Factory domains consume role/permission/outlet decisions but do not own them.

## Compatibility And Deferred Scope

Employee Directory, Roles, Permissions, and audit-oriented views remain grouped here.
Legacy fields or labels must not become competing role or Auth-link authorities.
External identity providers and HRIS synchronization remain deferred. Payroll now owns its separate effective-dated profile and foundation run authority in [Payroll](payroll.md); Employee Master remains its identity and legal-employer source, not its rate table.
An explicit UUID employee-outlet assignment is planned as a future compatibility hardening phase. Until then, the established Employee Master workplace resolver remains the canonical relationship consumed by Crew Workforce.
