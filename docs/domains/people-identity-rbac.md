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

## Lifecycle And Business Rules

Employee identity, job position, role, Admin access, and Crew Access are distinct concepts.
Editing an employee must not silently replace role or Auth linkage.
Role configuration is saved through the established trusted authority so permission replacement is atomic and auditable.
Employment-state changes must be respected by downstream Admin and Crew authorities.
The Employee Master Workplace is the current canonical input to Crew outlet scope. Crew Workforce may mirror that resolved outlet for credentials, but does not own a competing employee-outlet mapping; an Employee Master workplace change is the authoritative transfer event. `Factory` and `Management` are canonical non-outlet Workplace values. Factory employee selection uses one shared eligibility source: active employees whose Workplace is Factory or Management. It does not alter historical actor/provenance evidence or non-Factory employee selection.

The module registry defines available capabilities; roles grant permission to them but do not redefine route ownership.
UI gating mirrors authority for usability while RLS and trusted functions enforce access.

## Permissions And Audit

Only authorized Admins may manage employee, role, access, or scope relationships.
All affected outlet and record scopes must be validated.
Security-sensitive changes derive actor identity server-side and retain meaningful audit evidence.
Secrets, password material, passcode hashes, and tokens are never exposed in employee payloads or audit details.
Crew may update only the profile-photo object path derived for the employee resolved from its current opaque token. The private Storage object is read through the approved server boundary using a short-lived signed URL; neither employee ID nor arbitrary Storage path is accepted from Crew clients.

## Employee Compliance V1

People owns employee compliance. V1 has exactly two seeded requirements: Food Handler Certificate (one photo, no expiry) and Typhoid Injection (one photo with required expiry). Requirements apply to every active employee; there are no exemptions, position/outlet policies, notifications, or downstream eligibility effects.

Submissions are immutable and retain an outlet snapshot. Reviews are append-only, require the dedicated `employee_compliance.review` permission, enforce the employee's current outlet scope, and require a reason when rejected. Crew identity is always derived from the opaque Crew session token and Crew can never verify its own evidence.

Current state is a server-derived projection. A verified record is `Expiring Soon` within 30 days of expiry and `Expired` after expiry using the Malaysia business date. A pending replacement does not displace the latest verified record; it becomes effective only when verified. Rejected, superseded, and former-employee history remains private and retained.

Compliance evidence uses the private `employee-compliance-evidence` bucket with immutable versioned paths. Crew and authorized Admins receive only short-lived signed reads through the dedicated evidence authority. Compliance does not affect Performance, Reward, Attendance, Duty Roster, or Crew Special Access.

## Employee Disciplinary Records V1

People owns employee warnings and disciplinary records. V1 supports only First Written Warning and Final Written Warning; it is not a generic investigation, Show Cause, outcome, dismissal, or penalty engine. Draft warning content is editable by an Admin with `employee_disciplinary.manage` within the employee's current outlet scope. Issuance pins the employee, outlet snapshot, warning type, incident and issued dates, subject, details, required action, issuer, and optional private evidence. Issued content cannot be edited.

The canonical lifecycle is Draft, Issued, Delivered, Viewed, and Acknowledged, with controlled Not Acknowledged, Withdrawn, and Superseded outcomes. Crew list delivery records server-derived delivery evidence; opening detail records the first view; acknowledgement records receipt only and is not agreement, admission, or confirmation of misconduct. An optional employee response is append-only and does not alter the warning. If acknowledgement never occurs, Delivery and first View evidence remain authoritative.

Corrections never rewrite an issued record. Admins withdraw with a reason or issue a new warning linked as a superseding record; the original content, evidence, response, and chronological activity remain private history. Dedicated `employee_disciplinary.view` and `employee_disciplinary.manage` permissions are separate from general employee edit authority. Crew identity is derived only from its opaque session token and Crew can access only its own non-draft records.

Supporting evidence uses the private `employee-disciplinary-evidence` bucket with immutable object paths and short-lived authorized reads. Disciplinary records do not affect Performance, Reward, Attendance, Duty Roster, payroll, Tasks, or Crew Access. A future Incident / Show Cause / Response / Review / Outcome model may reference a warning as one possible outcome, but is deliberately outside V1.

## Workflows And Integrations

Admins create and maintain employees, link eligible Admin identities through controlled workflows, assign roles, configure permissions, and manage scope.
Crew Workforce consumes employee eligibility and maintains a separate Crew access extension.
All Restaurant, Crew, and Factory domains consume role/permission/outlet decisions but do not own them.

## Compatibility And Deferred Scope

Employee Directory, Roles, Permissions, and audit-oriented views remain grouped here.
Legacy fields or labels must not become competing role or Auth-link authorities.
External identity providers, HRIS synchronization, and payroll identity are deferred unless explicitly introduced.
An explicit UUID employee-outlet assignment is planned as a future compatibility hardening phase. Until then, the established Employee Master workplace resolver remains the canonical relationship consumed by Crew Workforce.
