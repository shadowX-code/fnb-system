-- Forward-only follow-up for staging, where 202608040001 is already recorded.
-- This migration contains only the verified remaining drift: read-only SOP
-- structure access for Production roles and authoritative completion guards.
-- Existing SOP, Production, inventory, movement and accounting rows are not
-- rewritten.

-- Production operators may review SOP instructions and QC definitions without
-- receiving any SOP management permission. Direct structural writes remain
-- controlled by the existing SOP RPC and privilege model.
drop policy if exists "factory sops view" on public.factory_production_sops;
create policy "factory sops view" on public.factory_production_sops
for select to authenticated
using (
  public.current_user_has_permission('factory_production_sop.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production.complete')
);

drop policy if exists "factory sop steps view" on public.factory_production_sop_steps;
create policy "factory sop steps view" on public.factory_production_sop_steps
for select to authenticated
using (
  public.current_user_has_permission('factory_production_sop.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production.complete')
);

drop policy if exists "factory sop sub steps view" on public.factory_production_sop_sub_steps;
create policy "factory sop sub steps view" on public.factory_production_sop_sub_steps
for select to authenticated
using (
  (
    public.current_user_has_permission('factory_production_sop.view')
    or public.current_user_has_permission('factory_production.view')
    or public.current_user_has_permission('factory_production.complete')
  )
  and exists (
    select 1
    from public.factory_production_sop_steps step
    where step.id = sop_step_id
  )
);

drop policy if exists "factory sop step materials view" on public.factory_production_sop_step_materials;
create policy "factory sop step materials view" on public.factory_production_sop_step_materials
for select to authenticated
using (
  (
    public.current_user_has_permission('factory_production_sop.view')
    or public.current_user_has_permission('factory_production.view')
    or public.current_user_has_permission('factory_production.complete')
  )
  and exists (
    select 1
    from public.factory_production_sop_steps step
    where step.id = sop_step_id
  )
);

drop policy if exists "factory sop step qc checks view" on public.factory_production_sop_step_qc_checks;
create policy "factory sop step qc checks view" on public.factory_production_sop_step_qc_checks
for select to authenticated
using (
  (
    public.current_user_has_permission('factory_production_sop.view')
    or public.current_user_has_permission('factory_production.view')
    or public.current_user_has_permission('factory_production.complete')
  )
  and exists (
    select 1
    from public.factory_production_sop_steps step
    where step.id = sop_step_id
  )
);

-- Phase 1 production is same-day. Every completed Production insert is checked
-- against the persisted Job Order start time before the completion RPC can
-- deduct materials, stock in finished goods or create movements. A trigger
-- exception aborts the surrounding transaction.
create or replace function public.factory_guard_production_completion_details()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_start_time time;
begin
  if lower(coalesce(new.status, '')) <> 'completed' then
    return new;
  end if;

  select job.start_time
  into v_job_start_time
  from public.factory_job_orders job
  where job.id = new.job_order_id;

  if not found then
    raise exception 'Job Order not found.';
  end if;
  if v_job_start_time is null then
    raise exception 'Job Order Start Time is required before completing production.';
  end if;
  if new.end_time is null then
    raise exception 'End Time is required.';
  end if;
  if new.end_time < v_job_start_time then
    raise exception 'End Time cannot be earlier than Start Time.';
  end if;
  if new.actual_pack_qty is null
     or new.actual_pack_qty <= 0
     or new.actual_pack_qty <> trunc(new.actual_pack_qty) then
    raise exception 'Actual Pack Qty must be a whole number greater than zero.';
  end if;

  -- Ignore any client-supplied Production start time. The Job Order is the
  -- authoritative source for validation and persistence.
  new.start_time := v_job_start_time;
  return new;
end;
$$;

drop trigger if exists factory_guard_production_completion_details_trigger
on public.factory_productions;
create trigger factory_guard_production_completion_details_trigger
before insert on public.factory_productions
for each row execute function public.factory_guard_production_completion_details();

revoke execute on function public.factory_guard_production_completion_details()
from public, anon, authenticated;
