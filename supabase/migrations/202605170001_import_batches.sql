-- Sprint 4A
-- Persist import batches for Sales/Purchase import audit and rollback foundation.

create extension if not exists pgcrypto;

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
  add column if not exists created_by uuid default auth.uid(),
  add column if not exists created_at timestamptz not null default now();

create index if not exists import_batches_created_at_idx
  on public.import_batches (created_at desc);

create index if not exists import_batches_type_period_idx
  on public.import_batches (import_type, year, month_start, month_end);

revoke all on table public.import_batches from anon;
grant select, insert on table public.import_batches to authenticated;
alter table public.import_batches enable row level security;

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
