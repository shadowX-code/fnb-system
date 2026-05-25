-- Asset Inspection System V2
-- Condition templates, evidence records, draft-capable summaries and audit-ready inspection item fields.

create table if not exists public.asset_condition_templates (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.asset_categories(id) on delete cascade,
  name text not null,
  severity text not null default 'healthy' check (severity in ('healthy', 'low', 'medium', 'high', 'critical')),
  color text not null default 'emerald',
  requires_photo boolean not null default false,
  requires_remark boolean not null default false,
  affects_health boolean not null default false,
  triggers_alert boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, name)
);

alter table public.asset_inspections
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists summary jsonb not null default '{}'::jsonb,
  add column if not exists notes text;

alter table public.asset_inspection_items
  add column if not exists expected_qty numeric,
  add column if not exists counted_qty numeric,
  add column if not exists condition_template_id uuid references public.asset_condition_templates(id),
  add column if not exists evidence_required boolean not null default false,
  add column if not exists evidence_status text not null default 'not_required' check (evidence_status in ('not_required', 'pending', 'complete'));

update public.asset_inspection_items
set expected_qty = expected_quantity
where expected_qty is null;

update public.asset_inspection_items
set counted_qty = counted_quantity
where counted_qty is null;

create table if not exists public.asset_inspection_evidence (
  id uuid primary key default gen_random_uuid(),
  inspection_item_id uuid not null references public.asset_inspection_items(id) on delete cascade,
  image_url text not null,
  caption text,
  created_at timestamptz not null default now()
);

create index if not exists asset_condition_templates_category_idx on public.asset_condition_templates (category_id, active, sort_order);
create index if not exists asset_inspection_evidence_item_idx on public.asset_inspection_evidence (inspection_item_id);

insert into public.asset_condition_templates (
  category_id,
  name,
  severity,
  color,
  requires_photo,
  requires_remark,
  affects_health,
  triggers_alert,
  active,
  sort_order
)
select c.id, template.name, template.severity, template.color, template.requires_photo, template.requires_remark, template.affects_health, template.triggers_alert, true, template.sort_order
from public.asset_categories c
cross join (
  values
    ('Good', 'healthy', 'emerald', false, false, false, false, 1),
    ('Damaged', 'high', 'orange', true, true, true, true, 2),
    ('Missing', 'critical', 'rose', true, true, true, true, 3)
) as template(name, severity, color, requires_photo, requires_remark, affects_health, triggers_alert, sort_order)
on conflict (category_id, name) do nothing;

grant select, insert, update, delete on table public.asset_condition_templates to authenticated;
grant select, insert, update, delete on table public.asset_inspection_evidence to authenticated;

revoke all on table public.asset_condition_templates from anon;
revoke all on table public.asset_inspection_evidence from anon;

alter table public.asset_condition_templates enable row level security;
alter table public.asset_inspection_evidence enable row level security;

drop policy if exists "asset tracking viewers can view condition templates" on public.asset_condition_templates;
create policy "asset tracking viewers can view condition templates"
on public.asset_condition_templates for select to authenticated
using (public.current_user_has_permission('asset_tracking.view'));

drop policy if exists "asset tracking creators can create condition templates" on public.asset_condition_templates;
create policy "asset tracking creators can create condition templates"
on public.asset_condition_templates for insert to authenticated
with check (public.current_user_has_permission('asset_tracking.create') or public.current_user_has_permission('asset_tracking.edit'));

drop policy if exists "asset tracking editors can update condition templates" on public.asset_condition_templates;
create policy "asset tracking editors can update condition templates"
on public.asset_condition_templates for update to authenticated
using (public.current_user_has_permission('asset_tracking.edit'))
with check (public.current_user_has_permission('asset_tracking.edit'));

drop policy if exists "asset tracking deleters can delete condition templates" on public.asset_condition_templates;
create policy "asset tracking deleters can delete condition templates"
on public.asset_condition_templates for delete to authenticated
using (public.current_user_has_permission('asset_tracking.delete'));

drop policy if exists "asset tracking viewers can view inspection evidence" on public.asset_inspection_evidence;
create policy "asset tracking viewers can view inspection evidence"
on public.asset_inspection_evidence for select to authenticated
using (public.current_user_has_permission('asset_tracking.view'));

drop policy if exists "asset tracking managers can create inspection evidence" on public.asset_inspection_evidence;
create policy "asset tracking managers can create inspection evidence"
on public.asset_inspection_evidence for insert to authenticated
with check (public.current_user_has_permission('asset_tracking.manage'));
