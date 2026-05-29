-- Stock Check Groups master persistence
-- Groups define outlet/category stock check schedules. Category memberships live in
-- inventory_stock_check_group_categories.

create extension if not exists pgcrypto;

create table if not exists public.inventory_stock_check_groups (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid references public.outlets(id) on delete set null,
  name text not null,
  description text,
  shift text,
  frequency_type text not null default 'custom',
  frequency_days text[] not null default '{}',
  schedule_config jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_stock_check_groups_outlet_idx
  on public.inventory_stock_check_groups (outlet_id);
create index if not exists inventory_stock_check_groups_status_idx
  on public.inventory_stock_check_groups (status);
create index if not exists inventory_stock_check_groups_frequency_idx
  on public.inventory_stock_check_groups (frequency_type);

do $$
begin
  alter table public.inventory_stock_check_groups
    add constraint inventory_stock_check_groups_frequency_check
    check (frequency_type in ('custom', 'monthly'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.inventory_stock_check_groups
    add constraint inventory_stock_check_groups_status_check
    check (status in ('active', 'inactive', 'archived'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.inventory_stock_check_group_categories
    add constraint inventory_stock_check_group_categories_group_fk
    foreign key (group_id)
    references public.inventory_stock_check_groups(id)
    on delete cascade;
exception
  when duplicate_object then null;
end $$;

grant select, insert, update, delete on table public.inventory_stock_check_groups to authenticated;
revoke all on table public.inventory_stock_check_groups from anon;

alter table public.inventory_stock_check_groups enable row level security;

drop policy if exists "inventory stock group viewers can view groups" on public.inventory_stock_check_groups;
create policy "inventory stock group viewers can view groups"
on public.inventory_stock_check_groups for select to authenticated
using (
  (
    public.current_user_has_permission('inventory_groups.view')
    or public.current_user_has_permission('inventory_stock_check.view')
    or public.current_user_has_permission('inventory_control.view')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory stock group creators can create groups" on public.inventory_stock_check_groups;
create policy "inventory stock group creators can create groups"
on public.inventory_stock_check_groups for insert to authenticated
with check (
  (
    public.current_user_has_permission('inventory_groups.create')
    or public.current_user_has_permission('inventory_control.manage_groups')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory stock group editors can update groups" on public.inventory_stock_check_groups;
create policy "inventory stock group editors can update groups"
on public.inventory_stock_check_groups for update to authenticated
using (
  (
    public.current_user_has_permission('inventory_groups.edit')
    or public.current_user_has_permission('inventory_control.manage_groups')
  )
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  (
    public.current_user_has_permission('inventory_groups.edit')
    or public.current_user_has_permission('inventory_control.manage_groups')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory stock group deleters can delete groups" on public.inventory_stock_check_groups;
create policy "inventory stock group deleters can delete groups"
on public.inventory_stock_check_groups for delete to authenticated
using (
  (
    public.current_user_has_permission('inventory_groups.delete')
    or public.current_user_has_permission('inventory_control.manage_groups')
  )
  and public.current_user_can_access_outlet(outlet_id)
);
