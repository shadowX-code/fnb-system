-- Register Product Feedback with the canonical Factory RBAC catalogue.
-- Existing role assignments remain managed through Role Settings; Owner/Admin
-- receive the baseline access used by other Factory modules.
insert into public.permissions (code, module, description)
values
  ('factory_product_feedback.view', 'Factory Product Feedback', 'View Factory Product Feedback campaigns and responses.'),
  ('factory_product_feedback.create', 'Factory Product Feedback', 'Create Factory Product Feedback campaigns.'),
  ('factory_product_feedback.edit', 'Factory Product Feedback', 'Edit Factory Product Feedback campaigns and variants.'),
  ('factory_product_feedback.manage', 'Factory Product Feedback', 'Manage Factory Product Feedback campaigns and responses.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code like 'factory_product_feedback.%'
where lower(r.name) in ('owner', 'admin')
on conflict do nothing;
