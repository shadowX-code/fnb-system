-- Controlled Job Order planning structure and lifecycle boundary.
--
-- Operational completeness requires:
--   * an active Packaging SKU / Finished Good;
--   * a positive Target Production Qty;
--   * a valid Production UOM that can be converted using the Packaging SKU;
--   * a positive DB-derived Estimated Pack Qty; and
--   * a Scheduled Date.
-- Priority, Due Date, Assigned Team and Remarks are optional. Priority is
-- normalized to Urgent, High, Normal or Low, with blank/unknown values becoming
-- Normal.

create or replace function public.factory_assign_job_order_planning_status()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_complete boolean;
begin
  v_complete := new.finished_good_id is not null
    and coalesce(new.target_pack_qty, 0) > 0
    and coalesce(new.target_production_qty, new.target_quantity, 0) > 0
    and nullif(btrim(coalesce(new.uom, '')), '') is not null
    and new.planned_date is not null;

  if tg_op = 'INSERT' then
    -- Initial lifecycle status is always authoritative, regardless of any value
    -- supplied by an older client or privileged internal caller.
    new.status := case when v_complete then 'planned' else 'draft' end;
    return new;
  end if;

  -- Direct authenticated updates are revoked below. Dedicated lifecycle RPCs
  -- may still transition status and are allowed to complete their guarded work.
  if lower(coalesce(new.status, '')) not in ('draft', 'planned')
     and lower(coalesce(new.status, '')) is distinct from lower(coalesce(old.status, '')) then
    return new;
  end if;

  if lower(coalesce(old.status, '')) not in ('draft', 'planned') then
    raise exception 'Only Draft or Planned Job Orders can be structurally edited.';
  end if;

  if lower(coalesce(old.status, '')) = 'planned' and not v_complete then
    raise exception 'Planned Job Orders must remain operationally complete.';
  end if;

  new.status := case when v_complete then 'planned' else 'draft' end;
  return new;
end;
$$;

drop trigger if exists factory_assign_job_order_planning_status_trigger
on public.factory_job_orders;

create trigger factory_assign_job_order_planning_status_trigger
before insert or update of finished_good_id, target_pack_qty, target_production_qty,
  target_quantity, uom, planned_date, status
on public.factory_job_orders
for each row
execute function public.factory_assign_job_order_planning_status();

comment on function public.factory_assign_job_order_planning_status() is
  'Derives Draft/Planned status for new and structurally edited Job Orders. Later lifecycle transitions remain exclusive to their controlled RPCs.';

create or replace function public.factory_save_job_order_structure(
  p_job_order_id uuid default null,
  p_finished_good_id uuid default null,
  p_target_quantity numeric default null,
  p_uom text default null,
  p_planned_date date default null,
  p_due_date date default null,
  p_priority text default null,
  p_assigned_team text default null,
  p_remarks text default null,
  p_target_pack_qty numeric default null,
  p_target_production_qty numeric default null
)
returns table(job_order_id uuid, job_order_no text, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.employees%rowtype;
  v_existing public.factory_job_orders%rowtype;
  v_saved public.factory_job_orders%rowtype;
  v_finished_good public.factory_finished_goods%rowtype;
  v_recipe_uom text;
  v_requested_production_qty numeric;
  v_expected_pack_qty numeric;
  v_expected_production_qty numeric;
  v_expected_production_uom text;
  v_is_complete boolean := false;
  v_priority text;
  v_yymmdd text := to_char(current_date, 'YYMMDD');
  v_next integer;
  v_job_order_no text;
  v_actor_name text;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to save Job Orders.';
  end if;

  select employee.*
  into v_actor
  from public.employees employee
  where employee.auth_user_id = auth.uid()
    and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id asc
  limit 1;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'An active employee profile is required to save Job Orders.';
  end if;

  if p_job_order_id is null then
    if not public.current_user_has_permission('factory_job_orders.create') then
      raise exception using
        errcode = '42501',
        message = 'Missing permission to create Job Orders.';
    end if;
  else
    if not public.current_user_has_permission('factory_job_orders.edit') then
      raise exception using
        errcode = '42501',
        message = 'Missing permission to edit Job Orders.';
    end if;

    select job.*
    into v_existing
    from public.factory_job_orders job
    where job.id = p_job_order_id
    for update;

    if not found then
      raise exception 'Job Order was not found.';
    end if;

    if lower(coalesce(v_existing.status, '')) not in ('draft', 'planned') then
      raise exception 'Only Draft or Planned Job Orders can be edited.';
    end if;
  end if;

  if coalesce(p_target_production_qty, p_target_quantity, 0) < 0
     or coalesce(p_target_pack_qty, 0) < 0 then
    raise exception 'Job Order quantities cannot be negative.';
  end if;

  v_requested_production_qty := coalesce(p_target_production_qty, p_target_quantity, 0);
  v_priority := case lower(btrim(coalesce(p_priority, '')))
    when 'urgent' then 'Urgent'
    when 'high' then 'High'
    when 'low' then 'Low'
    else 'Normal'
  end;

  if p_finished_good_id is not null then
    select finished_good.*
    into v_finished_good
    from public.factory_finished_goods finished_good
    where finished_good.id = p_finished_good_id
    for share;

    if not found then
      raise exception 'Packaging SKU was not found.';
    end if;

    if lower(coalesce(v_finished_good.status, '')) <> 'active' then
      raise exception 'Packaging SKU must be active before saving a Job Order.';
    end if;

    if coalesce(v_finished_good.pack_size_qty, v_finished_good.base_qty, 0) <= 0
       or coalesce(
         nullif(btrim(v_finished_good.pack_size_uom), ''),
         nullif(btrim(v_finished_good.base_uom), '')
       ) is null then
      raise exception 'Packaging SKU needs Pack Size before saving a Job Order.';
    end if;
  end if;

  if p_finished_good_id is not null
     and v_requested_production_qty > 0
     and nullif(btrim(coalesce(p_uom, '')), '') is not null then
    select recipe.uom
    into v_recipe_uom
    from public.factory_product_recipes recipe
    where lower(coalesce(recipe.status, '')) = 'active'
      and recipe.product_family_id is not null
      and recipe.product_family_id = v_finished_good.product_family_id
    order by recipe.updated_at desc nulls last, recipe.created_at desc nulls last, recipe.id desc
    limit 1;

    if v_recipe_uom is null then
      select recipe.uom
      into v_recipe_uom
      from public.factory_product_recipes recipe
      where lower(coalesce(recipe.status, '')) = 'active'
        and recipe.finished_good_id = v_finished_good.id
      order by recipe.updated_at desc nulls last, recipe.created_at desc nulls last, recipe.id desc
      limit 1;
    end if;

    select plan.target_pack_qty, plan.target_production_qty, plan.production_uom
    into v_expected_pack_qty, v_expected_production_qty, v_expected_production_uom
    from public.factory_packaging_pack_estimate(
      v_requested_production_qty,
      p_uom,
      coalesce(v_finished_good.pack_size_qty, v_finished_good.base_qty),
      coalesce(v_finished_good.pack_size_uom, v_finished_good.base_uom),
      v_recipe_uom
    ) plan;

    if p_target_pack_qty is not null
       and abs(p_target_pack_qty - v_expected_pack_qty) > 0.000001 then
      raise exception 'Estimated Pack Qty does not match Target Production Qty and Packaging SKU Pack Size.';
    end if;

    if abs(v_requested_production_qty - v_expected_production_qty) > 0.000001 then
      raise exception 'Target Production Qty does not match normalized Production UOM.';
    end if;

    v_is_complete := coalesce(v_expected_pack_qty, 0) > 0
      and coalesce(v_expected_production_qty, 0) > 0
      and nullif(btrim(coalesce(v_expected_production_uom, '')), '') is not null
      and p_planned_date is not null;
  end if;

  if p_job_order_id is not null
     and lower(coalesce(v_existing.status, '')) = 'planned'
     and not v_is_complete then
    raise exception 'Planned Job Orders must remain operationally complete.';
  end if;

  v_actor_name := coalesce(v_actor.nickname, v_actor.full_name, 'Authenticated User');

  if p_job_order_id is null then
    perform pg_advisory_xact_lock(hashtextextended('factory_job_order:JO:' || v_yymmdd, 0));

    select coalesce(max((substring(job.job_order_no from ('^JO' || v_yymmdd || '-([0-9]+)$')))::integer), 0) + 1
    into v_next
    from public.factory_job_orders job
    where job.job_order_no ~ ('^JO' || v_yymmdd || '-[0-9]+$');

    v_job_order_no := 'JO' || v_yymmdd || '-' || lpad(v_next::text, 3, '0');

    insert into public.factory_job_orders (
      job_order_no,
      finished_good_id,
      product_name,
      target_pack_qty,
      target_production_qty,
      target_quantity,
      produced_quantity,
      uom,
      planned_date,
      due_date,
      priority,
      status,
      assigned_team,
      remarks,
      created_by,
      updated_at
    ) values (
      v_job_order_no,
      v_finished_good.id,
      coalesce(v_finished_good.product_name, ''),
      case when v_expected_pack_qty > 0 then v_expected_pack_qty else null end,
      case when v_expected_production_qty > 0 then v_expected_production_qty else v_requested_production_qty end,
      coalesce(case when v_expected_production_qty > 0 then v_expected_production_qty else v_requested_production_qty end, 0),
      0,
      coalesce(v_expected_production_uom, nullif(btrim(coalesce(p_uom, '')), '')),
      p_planned_date,
      p_due_date,
      v_priority,
      case when v_is_complete then 'planned' else 'draft' end,
      coalesce(p_assigned_team, ''),
      coalesce(p_remarks, ''),
      v_actor.id,
      now()
    )
    returning * into v_saved;

    insert into public.audit_logs (
      action, module, user_id, user_name, description, metadata, created_at
    ) values (
      'factory_job_order_created',
      'factory',
      auth.uid(),
      v_actor_name,
      case when lower(v_saved.status) = 'planned'
        then 'Factory Job Order scheduled.'
        else 'Factory Job Order draft created.'
      end,
      jsonb_build_object(
        'target', v_saved.job_order_no,
        'job_order_id', v_saved.id,
        'after', to_jsonb(v_saved)
      ),
      now()
    );
  else
    update public.factory_job_orders job
    set finished_good_id = p_finished_good_id,
        product_name = coalesce(v_finished_good.product_name, ''),
        target_pack_qty = case when v_expected_pack_qty > 0 then v_expected_pack_qty else null end,
        target_production_qty = case when v_expected_production_qty > 0 then v_expected_production_qty else v_requested_production_qty end,
        target_quantity = coalesce(case when v_expected_production_qty > 0 then v_expected_production_qty else v_requested_production_qty end, 0),
        uom = coalesce(v_expected_production_uom, nullif(btrim(coalesce(p_uom, '')), '')),
        planned_date = p_planned_date,
        due_date = p_due_date,
        priority = v_priority,
        status = case when v_is_complete then 'planned' else 'draft' end,
        assigned_team = coalesce(p_assigned_team, ''),
        remarks = coalesce(p_remarks, ''),
        updated_at = now()
    where job.id = p_job_order_id
    returning * into v_saved;

    insert into public.audit_logs (
      action, module, user_id, user_name, description, metadata, created_at
    ) values (
      'factory_job_order_updated',
      'factory',
      auth.uid(),
      v_actor_name,
      'Factory Job Order planning structure updated.',
      jsonb_build_object(
        'target', v_saved.job_order_no,
        'job_order_id', v_saved.id,
        'before', to_jsonb(v_existing),
        'after', to_jsonb(v_saved)
      ),
      now()
    );
  end if;

  return query
  select v_saved.id, v_saved.job_order_no, v_saved.status;
end;
$$;

create or replace function public.factory_delete_job_order_draft(
  p_job_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.employees%rowtype;
  v_job public.factory_job_orders%rowtype;
  v_actor_name text;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to delete Job Orders.';
  end if;

  if not public.current_user_has_permission('factory_job_orders.delete') then
    raise exception using
      errcode = '42501',
      message = 'Missing permission to delete Job Orders.';
  end if;

  select employee.*
  into v_actor
  from public.employees employee
  where employee.auth_user_id = auth.uid()
    and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id asc
  limit 1;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'An active employee profile is required to delete Job Orders.';
  end if;

  select job.*
  into v_job
  from public.factory_job_orders job
  where job.id = p_job_order_id
  for update;

  if not found then
    raise exception 'Job Order was not found.';
  end if;

  if lower(coalesce(v_job.status, '')) <> 'draft' then
    raise exception 'Only Draft Job Orders can be deleted.';
  end if;

  -- Production records retain their own accounting and movement children, while
  -- execution/QC snapshots cascade from the Job Order. Reject the delete before
  -- either relationship can be orphaned or erased.
  if v_job.started_at is not null
     or v_job.started_by is not null
     or v_job.production_operator_id is not null
     or nullif(btrim(coalesce(v_job.production_operator_name, '')), '') is not null
     or v_job.production_date is not null
     or v_job.start_time is not null
     or v_job.production_sop_id is not null
     or nullif(btrim(coalesce(v_job.sop_version, '')), '') is not null
     or v_job.qc_snapshot_created_at is not null
     or v_job.completed_at is not null
     or v_job.completed_by is not null
     or coalesce(v_job.produced_quantity, 0) <> 0
     or exists (
       select 1
       from public.factory_productions production
       where production.job_order_id = v_job.id
     )
     or exists (
       select 1
       from public.factory_production_step_executions execution
       where execution.job_order_id = v_job.id
     )
     or exists (
       select 1
       from public.factory_production_qc_results result
       where result.job_order_id = v_job.id
     ) then
    raise exception 'Draft Job Order cannot be deleted because Production history already exists.';
  end if;

  delete from public.factory_job_orders job
  where job.id = v_job.id;

  v_actor_name := coalesce(v_actor.nickname, v_actor.full_name, 'Authenticated User');

  insert into public.audit_logs (
    action, module, user_id, user_name, description, metadata, created_at
  ) values (
    'factory_job_order_deleted',
    'factory',
    auth.uid(),
    v_actor_name,
    'Factory Job Order draft deleted.',
    jsonb_build_object(
      'target', v_job.job_order_no,
      'job_order_id', v_job.id,
      'before', to_jsonb(v_job)
    ),
    now()
  );
end;
$$;

revoke all on function public.factory_save_job_order_structure(
  uuid, uuid, numeric, text, date, date, text, text, text, numeric, numeric
) from public, anon;
grant execute on function public.factory_save_job_order_structure(
  uuid, uuid, numeric, text, date, date, text, text, text, numeric, numeric
) to authenticated;

revoke all on function public.factory_delete_job_order_draft(uuid)
from public, anon;
grant execute on function public.factory_delete_job_order_draft(uuid)
to authenticated;

-- The legacy create RPC accepts a client-provided employee UUID and runs as an
-- invoker. New clients must use the controlled structure-save RPC above.
revoke all on function public.factory_create_job_order(
  uuid, numeric, text, date, date, text, text, text, uuid
) from public, anon, authenticated;

revoke all on function public.factory_create_job_order(
  uuid, numeric, text, date, date, text, text, text, uuid, numeric, numeric
) from public, anon, authenticated;

-- Read access remains governed by the existing RLS SELECT policy. All Job Order
-- writes now pass through controlled SECURITY DEFINER RPCs with explicit checks.
revoke insert, update, delete on table public.factory_job_orders
from public, anon, authenticated;
