-- Outlet P&L + Operating Expenses module.
-- Adds monthly OpEx persistence, permissions, owner/admin grants and RLS.

create extension if not exists pgcrypto;

create table if not exists public.operating_expenses (
  id uuid primary key default gen_random_uuid()
);

alter table public.operating_expenses
  add column if not exists outlet_id uuid references public.outlets(id) on delete cascade,
  add column if not exists year int,
  add column if not exists month int,
  add column if not exists amount numeric not null default 0,
  add column if not exists remark text,
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.operating_expenses
  alter column outlet_id set not null,
  alter column year set not null,
  alter column month set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'operating_expenses_unique_period'
      and conrelid = 'public.operating_expenses'::regclass
  ) then
    alter table public.operating_expenses
      add constraint operating_expenses_unique_period unique (outlet_id, year, month);
  end if;
end $$;

create index if not exists operating_expenses_period_idx
  on public.operating_expenses (outlet_id, year, month);

insert into public.permissions (code, module, description)
values
  ('outlet_pnl.view', 'Outlet P&L', 'View Outlet P&L.'),
  ('outlet_pnl.export', 'Outlet P&L', 'Export Outlet P&L.'),
  ('operating_expenses.view', 'Operating Expenses', 'View Operating Expenses.'),
  ('operating_expenses.create', 'Operating Expenses', 'Create Operating Expenses.'),
  ('operating_expenses.edit', 'Operating Expenses', 'Edit Operating Expenses.'),
  ('operating_expenses.delete', 'Operating Expenses', 'Delete Operating Expenses.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.name in ('owner', 'admin')
  and p.code in (
    'outlet_pnl.view',
    'outlet_pnl.export',
    'operating_expenses.view',
    'operating_expenses.create',
    'operating_expenses.edit',
    'operating_expenses.delete'
  )
on conflict do nothing;

alter table public.operating_expenses enable row level security;
grant select, insert, update, delete on table public.operating_expenses to authenticated;
revoke all on table public.operating_expenses from anon;

drop policy if exists "operating expenses can be selected by permitted users" on public.operating_expenses;
create policy "operating expenses can be selected by permitted users"
on public.operating_expenses for select to authenticated
using (
  public.current_user_has_permission('operating_expenses.view')
  or public.current_user_has_permission('outlet_pnl.view')
);

drop policy if exists "operating expenses can be inserted by permitted users" on public.operating_expenses;
create policy "operating expenses can be inserted by permitted users"
on public.operating_expenses for insert to authenticated
with check (public.current_user_has_permission('operating_expenses.create'));

drop policy if exists "operating expenses can be updated by permitted users" on public.operating_expenses;
create policy "operating expenses can be updated by permitted users"
on public.operating_expenses for update to authenticated
using (public.current_user_has_permission('operating_expenses.edit'))
with check (public.current_user_has_permission('operating_expenses.edit'));

drop policy if exists "operating expenses can be deleted by permitted users" on public.operating_expenses;
create policy "operating expenses can be deleted by permitted users"
on public.operating_expenses for delete to authenticated
using (public.current_user_has_permission('operating_expenses.delete'));

do $$
begin
  if to_regclass('public.sales_records') is not null then
    execute 'drop policy if exists "sales records can be selected by permitted users" on public.sales_records';
    execute '
      create policy "sales records can be selected by permitted users"
      on public.sales_records for select to authenticated
      using (
        public.current_user_has_permission(''sales_input.view'')
        or public.current_user_has_permission(''sales_comparison.view'')
        or public.current_user_has_permission(''dashboard.view'')
        or public.current_user_has_permission(''outlet_pnl.view'')
      )';
  end if;

  if to_regclass('public.purchase_records') is not null then
    execute 'drop policy if exists "purchase records can be selected by permitted users" on public.purchase_records';
    execute '
      create policy "purchase records can be selected by permitted users"
      on public.purchase_records for select to authenticated
      using (
        public.current_user_has_permission(''purchase_input.view'')
        or public.current_user_has_permission(''purchase_comparison.view'')
        or public.current_user_has_permission(''dashboard.view'')
        or public.current_user_has_permission(''outlet_pnl.view'')
      )';
  end if;

  if to_regclass('public.outlets') is not null then
    execute 'drop policy if exists "outlet viewers can view outlets" on public.outlets';
    execute '
      create policy "outlet viewers can view outlets"
      on public.outlets for select to authenticated
      using (
        public.current_user_has_permission(''outlets.view'')
        or public.current_user_has_permission(''dashboard.view'')
        or public.current_user_has_permission(''sales_input.view'')
        or public.current_user_has_permission(''purchase_input.view'')
        or public.current_user_has_permission(''data_import.view'')
        or public.current_user_has_permission(''outlet_pnl.view'')
        or public.current_user_has_permission(''operating_expenses.view'')
      )';
  end if;

  if to_regclass('public.sales_channels') is not null then
    execute 'drop policy if exists "sales channel viewers can view sales channels" on public.sales_channels';
    execute '
      create policy "sales channel viewers can view sales channels"
      on public.sales_channels for select to authenticated
      using (
        public.current_user_has_permission(''sales_channels.view'')
        or public.current_user_has_permission(''dashboard.view'')
        or public.current_user_has_permission(''sales_input.view'')
        or public.current_user_has_permission(''sales_comparison.view'')
        or public.current_user_has_permission(''data_import.view'')
        or public.current_user_has_permission(''outlet_pnl.view'')
      )';
  end if;
end $$;
