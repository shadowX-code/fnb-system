-- Asset Inspection draft resume support.

alter table public.asset_inspections
  add column if not exists current_step integer not null default 1,
  add column if not exists completion_percentage numeric not null default 0,
  add column if not exists last_edited_at timestamptz,
  add column if not exists last_edited_by uuid references auth.users(id),
  add column if not exists draft_data jsonb not null default '{}'::jsonb,
  add column if not exists auto_saved boolean not null default false;

do $$
begin
  alter table public.asset_inspections
    drop constraint if exists asset_inspections_status_check;

  alter table public.asset_inspections
    add constraint asset_inspections_status_check
    check (status in ('draft', 'in_progress', 'pending_review', 'submitted', 'completed', 'archived', 'partial'));
end $$;

create index if not exists asset_inspections_status_idx on public.asset_inspections (status, outlet_id, updated_at desc);

drop policy if exists "asset tracking managers can delete inspection drafts" on public.asset_inspections;
create policy "asset tracking managers can delete inspection drafts"
on public.asset_inspections for delete to authenticated
using (
  public.current_user_has_permission('asset_tracking.manage')
  and status in ('draft', 'in_progress', 'pending_review', 'archived')
);
