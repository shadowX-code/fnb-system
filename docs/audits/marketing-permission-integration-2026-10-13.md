# Marketing permission integration — Staging audit

Verified 13 October 2026. Canonical permission definitions, applied Staging functions and existing identities override earlier summaries.

## Authority and coverage

`config/modules.ts` defines 45 Marketing permissions plus two shared Platform permissions in 14 permission-owning modules. All 47 codes exist in the Staging catalog. `roles`, `role_permissions` and `save_role_configuration` remain the role authority. Marketing has no independent role definitions. Effective access requires active FeedX identity, Workspace Access, the requested action, internal membership and permitted Brand scope; approval, platform capability and execution gates remain additional conditions.

| Business surface | Existing authority |
| --- | --- |
| Workspace entry | `marketing_workspace.access` |
| Overview | `marketing_overview.view` |
| Content Planner | `marketing_planner`: view, create, edit, manage, approve, configure, delete |
| Content Management | `marketing_calendar.view` or `marketing_content.view` for reading; Content owns create, edit, review, approve, publish/schedule, execute, cancel, upload |
| Media Library | Reuses `marketing_content.view` and `.upload`; Drive connection/map administration retains Settings and Platform conditions |
| Conversations | `marketing_inbox`: view, manage, reply, send, ai, approve, configure |
| CRM Customers | `marketing_audience.view/manage`; shared identity/import editing additionally uses `platform_customers.manage` |
| WhatsApp Message | `marketing_campaigns`: view, manage, approve, execute; manual handling never establishes API delivery |
| Creators | `marketing_creators.view/manage`; shared Creator identity does not bypass Brand collaboration visibility |
| Social Analytics | `marketing_analytics.view` |
| Ads Analytics/management | `marketing_ads`: view, connect, manage, review, approve, execute, ai; shared-account visibility still follows verified campaign attribution and Brand scope |
| Connections / Brand Knowledge / Brand Access | Reuse `marketing_settings.view`; `.manage` owns knowledge, `.configure` integrations/scope; Platform team management and role delegation retain their own checks |
| Brand/team management | `platform_organizations.manage`; canonical Brand Master remains Restaurant → System → Brands |

## Confirmed defects corrected

- Matrix cells added nonexistent `.view` dependencies to permission owners without View. Marketing Workspace is an intentional non-routable entry module with a real Access action, not an action-free container. The phantom dependency falsely showed its Access cell Off in a fully authorized role and could submit an unknown permission during editing. A zero action count on Manager is separately expected because that role currently has no Marketing grant. View implication now applies only to modules defining View.
- Marketing fell into the Restaurant category; global columns also exposed unrelated Payroll actions. Reading/editing now share a Workspace/Module-filtered matrix, grouped by registered workspace, with relevant action columns and responsive row presentation.
- `marketing_ads.connect` already existed in Staging and Ads contracts but Connect was omitted from the shared action order, hiding it and filtering it out of role edits. Its canonical registration is restored without assigning it to any role.
- Counting any dependency as an active action inflated counts when only View existed. Counts now use the complete cell dependency set.
- Fresh ungrantable actions were clickable even though trusted delegation rejected them. The editor now mirrors the existing delegation boundary, retaining server enforcement.
- Brand-scope controls now explicitly describe role-wide impact and link to canonical action-permission configuration; role-view compatibility aliases are reused.

## Runtime evidence and unchanged data

Read-only Staging transactions, under the existing authenticated-role claim context, verified Owner access to Idamans; active Manager denial without Marketing grants; the existing QA Marketing role's permitted Brand read; denial of another Brand and another tenant; and denial for a same-role identity lacking membership. No test role, grant, membership or scope was created or modified.

Owner/Admin retain protected-role server semantics despite zero explicit Marketing join rows. Manager, Accounts and existing Factory/Crew test roles have no Marketing grants. The existing dedicated Marketing QA role has the 47 registered Marketing/Platform grants and one permitted QA Brand. These are observed configurations, not recommended grant changes.

Publishing, replies, Ads and Planner review authorities were not replaced. Their existing action codes and server execution contracts remain unchanged. This task did not activate execution or exercise an external mutation.

## Remaining decisions

- Assigning Marketing actions or Brand access to real staff requires explicit authorization; no role grants or memberships were changed.
- Brand scope currently applies per canonical role within an internal tenancy. Different Brand scope for individual members sharing one role would require a separately scoped authority design; this audit does not introduce it.
- Media Library and the three Settings routes intentionally reuse existing permissions. Independent per-page grants would be a product/permission migration decision, not a missing catalog entry.

Two pre-existing declared Factory MeSTI action types (`record`, `verify`) also lack shared action-order registration. They are outside this Marketing task; no Factory grants or definitions were changed. Their runtime contracts should be audited in a separate focused task before any correction.
