-- Guest AI is a workspace-level domain.  These explicit permissions do not
-- inherit Restaurant, Factory, or Crew access.
insert into public.permissions (code, module, description)
values
  ('guest_ai.access', 'Guest AI Workspace', 'Access Guest AI overview, devices, interactions, and AI Studio.'),
  ('guest_ai.developer', 'Guest AI Workspace', 'Access Guest AI Developer Console and local device diagnostics.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

-- Existing protected platform roles receive the new explicitly registered
-- permissions; all other roles remain denied until an administrator grants
-- them through the canonical role configuration flow.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('guest_ai.access', 'guest_ai.developer')
where lower(r.name) in ('owner', 'admin')
on conflict do nothing;
