-- Sprint 4C: production import integrity and auditability.
-- Adds guarded business-key uniqueness, import lifecycle status, and row-level
-- import detail tracking without assuming existing data is already clean.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.sales_records') is not null
     and not exists (
       select 1
       from pg_indexes
       where schemaname = 'public'
         and indexname = 'sales_records_unique_import_key'
     ) then
    if not exists (
      select 1
      from public.sales_records
      where outlet_id is not null
        and year is not null
        and month is not null
        and channel_id is not null
      group by outlet_id, year, month, channel_id
      having count(*) > 1
    ) then
      execute 'create unique index sales_records_unique_import_key on public.sales_records (outlet_id, year, month, channel_id)';
    else
      raise notice 'Skipped sales_records_unique_import_key because duplicate sales import keys exist.';
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.purchase_records') is not null
     and not exists (
       select 1
       from pg_indexes
       where schemaname = 'public'
         and indexname = 'purchase_records_unique_import_key'
     ) then
    if not exists (
      select 1
      from public.purchase_records
      where outlet_id is not null
        and year is not null
        and month is not null
        and supplier_id is not null
        and category_id is not null
      group by outlet_id, year, month, supplier_id, category_id
      having count(*) > 1
    ) then
      execute 'create unique index purchase_records_unique_import_key on public.purchase_records (outlet_id, year, month, supplier_id, category_id)';
    else
      raise notice 'Skipped purchase_records_unique_import_key because duplicate purchase import keys exist.';
    end if;
  end if;
end $$;

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid()
);

alter table public.import_batches
  add column if not exists import_type text,
  add column if not exists outlet_id uuid references public.outlets(id) on delete set null,
  add column if not exists year integer,
  add column if not exists month_start integer,
  add column if not exists month_end integer,
  add column if not exists source_filename text,
  add column if not exists total_rows integer not null default 0,
  add column if not exists created_count integer not null default 0,
  add column if not exists updated_count integer not null default 0,
  add column if not exists failed_count integer not null default 0,
  add column if not exists warning_count integer not null default 0,
  add column if not exists status text not null default 'pending',
  add column if not exists created_by uuid default auth.uid(),
  add column if not exists imported_by uuid default auth.uid(),
  add column if not exists imported_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists failure_reason text,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'import_batches_status_check'
      and conrelid = 'public.import_batches'::regclass
  ) then
    alter table public.import_batches
      add constraint import_batches_status_check
      check (status in ('pending', 'validating', 'completed', 'partial_failed', 'failed'));
  end if;
end $$;

create table if not exists public.import_batch_rows (
  id uuid primary key default gen_random_uuid()
);

alter table public.import_batch_rows
  add column if not exists batch_id uuid references public.import_batches(id) on delete cascade,
  add column if not exists source_row integer,
  add column if not exists raw_row jsonb,
  add column if not exists action text,
  add column if not exists validation_result text,
  add column if not exists imported_record_id uuid,
  add column if not exists failure_reason text,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'import_batch_rows_action_check'
      and conrelid = 'public.import_batch_rows'::regclass
  ) then
    alter table public.import_batch_rows
      add constraint import_batch_rows_action_check
      check (action in ('create', 'update', 'skip', 'failed'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'import_batch_rows_validation_result_check'
      and conrelid = 'public.import_batch_rows'::regclass
  ) then
    alter table public.import_batch_rows
      add constraint import_batch_rows_validation_result_check
      check (validation_result in ('success', 'warning', 'skipped', 'failed'));
  end if;
end $$;

create index if not exists import_batches_created_at_idx
  on public.import_batches (created_at desc);

create index if not exists import_batches_status_idx
  on public.import_batches (status, created_at desc);

create index if not exists import_batch_rows_batch_idx
  on public.import_batch_rows (batch_id);

revoke all on table public.import_batches from anon;
revoke all on table public.import_batch_rows from anon;
grant select, insert, update on table public.import_batches to authenticated;
grant select, insert on table public.import_batch_rows to authenticated;

alter table public.import_batches enable row level security;
alter table public.import_batch_rows enable row level security;

drop policy if exists "data import viewers can view import batches" on public.import_batches;
create policy "data import viewers can view import batches"
on public.import_batches for select to authenticated
using (
  public.current_user_has_permission('data_import.view')
  or public.current_user_has_permission('audit_logs.view')
);

drop policy if exists "data import users can create import batches" on public.import_batches;
create policy "data import users can create import batches"
on public.import_batches for insert to authenticated
with check (public.current_user_has_permission('data_import.import'));

drop policy if exists "data import users can update import batches" on public.import_batches;
create policy "data import users can update import batches"
on public.import_batches for update to authenticated
using (public.current_user_has_permission('data_import.import'))
with check (public.current_user_has_permission('data_import.import'));

drop policy if exists "data import viewers can view import batch rows" on public.import_batch_rows;
create policy "data import viewers can view import batch rows"
on public.import_batch_rows for select to authenticated
using (
  public.current_user_has_permission('data_import.view')
  or public.current_user_has_permission('audit_logs.view')
);

drop policy if exists "data import users can create import batch rows" on public.import_batch_rows;
create policy "data import users can create import batch rows"
on public.import_batch_rows for insert to authenticated
with check (public.current_user_has_permission('data_import.import'));
