# People, Identity, And RBAC

## Purpose And Scope

This domain owns the employee master record, Admin authentication linkage, role assignment, permissions, outlet scope, and the security relationships consumed by every FeedX workspace.
It does not own Crew passcode/session lifecycle, which belongs to Crew Workforce.

## Canonical Ownership

Current employee, role, permission, Auth-link, role-configuration, RLS, and audit contracts are authoritative.
`employees.role_id` is the canonical employee-role assignment.
`employees.auth_user_id` is the canonical employee-to-Supabase-Auth link.

## Core Entities

- Employee master records and employment state
- Supabase Auth users linked to employees
- Roles, permissions, module capabilities, and role configuration
- Outlet access and other explicit scope relationships
- Admin access state and security-relevant audit events

## Lifecycle And Business Rules

Employee identity, job position, role, Admin access, and Crew Access are distinct concepts.
Editing an employee must not silently replace role or Auth linkage.
Role configuration is saved through the established trusted authority so permission replacement is atomic and auditable.
Employment-state changes must be respected by downstream Admin and Crew authorities.

The module registry defines available capabilities; roles grant permission to them but do not redefine route ownership.
UI gating mirrors authority for usability while RLS and trusted functions enforce access.

## Permissions And Audit

Only authorized Admins may manage employee, role, access, or scope relationships.
All affected outlet and record scopes must be validated.
Security-sensitive changes derive actor identity server-side and retain meaningful audit evidence.
Secrets, password material, passcode hashes, and tokens are never exposed in employee payloads or audit details.

## Workflows And Integrations

Admins create and maintain employees, link eligible Admin identities through controlled workflows, assign roles, configure permissions, and manage scope.
Crew Workforce consumes employee eligibility and maintains a separate Crew access extension.
All Restaurant, Crew, and Factory domains consume role/permission/outlet decisions but do not own them.

## Compatibility And Deferred Scope

Employee Directory, Roles, Permissions, and audit-oriented views remain grouped here.
Legacy fields or labels must not become competing role or Auth-link authorities.
External identity providers, HRIS synchronization, and payroll identity are deferred unless explicitly introduced.
