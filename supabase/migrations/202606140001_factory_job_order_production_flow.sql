-- Factory Job Order and Production MES-style flow.
-- Adds DB-side JO reference generation, release/start metadata, and completion guards.

alter table public.factory_job_orders
  add column if not exists released_at timestamptz,
  add column if not exists released_by uuid references public.employees(id),
  add column if not exists started_at timestamptz,
  add column if not exists started_by uuid references public.employees(id),
  add column if not exists production_operator_id uuid references public.employees(id),
  add column if not exists production_operator_name text,
  add column if not exists production_date date,
  add column if not exists start_time time,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references public.employees(id);

update public.factory_job_orders
set status = 'released',
    updated_at = now()
where status = 'planned';

create index if not exists factory_job_orders_status_idx
on public.factory_job_orders(status);

create or replace function public.factory_create_job_order(
  p_finished_good_id uuid,
  p_target_quantity numeric,
  p_uom text,
  p_planned_date date,
  p_due_date date,
  p_priority text,
  p_assigned_team text,
  p_remarks text,
  p_created_by uuid
)
returns table(id uuid, job_order_no text)
language plpgsql
security invoker
as $$
declare
  v_yymmdd text := to_char(current_date, 'YYMMDD');
  v_next integer;
  v_job_order_id uuid;
  v_job_order_no text;
  v_finished_good public.factory_finished_goods%rowtype;
begin
  if not public.current_user_has_permission('factory_job_orders.create') then
    raise exception 'Missing permission to create Job Orders.';
  end if;

  if p_finished_good_id is null then
    raise exception 'Finished Good is required.';
  end if;

  if coalesce(p_target_quantity, 0) <= 0 then
    raise exception 'Target quantity must be greater than 0.';
  end if;

  select * into v_finished_good
  from public.factory_finished_goods
  where id = p_finished_good_id
  for update;

  if v_finished_good.id is null or lower(coalesce(v_finished_good.status, '')) <> 'active' then
    raise exception 'Finished Good must be active before creating a Job Order.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('factory_job_order:JO:' || v_yymmdd, 0));

  select coalesce(max((substring(jo.job_order_no from ('^JO' || v_yymmdd || '-([0-9]+)$')))::integer), 0) + 1
  into v_next
  from public.factory_job_orders jo
  where jo.job_order_no ~ ('^JO' || v_yymmdd || '-[0-9]+$');

  v_job_order_no := 'JO' || v_yymmdd || '-' || lpad(v_next::text, 3, '0');

  insert into public.factory_job_orders (
    job_order_no,
    finished_good_id,
    product_name,
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
  )
  values (
    v_job_order_no,
    v_finished_good.id,
    v_finished_good.product_name,
    p_target_quantity,
    0,
    coalesce(nullif(trim(coalesce(p_uom, '')), ''), v_finished_good.uom),
    p_planned_date,
    p_due_date,
    coalesce(nullif(trim(coalesce(p_priority, '')), ''), 'Normal'),
    'draft',
    coalesce(p_assigned_team, ''),
    coalesce(p_remarks, ''),
    p_created_by,
    now()
  )
  returning factory_job_orders.id into v_job_order_id;

  return query select v_job_order_id as id, v_job_order_no as job_order_no;
end;
$$;

grant execute on function public.factory_create_job_order(uuid, numeric, text, date, date, text, text, text, uuid) to authenticated;

create or replace function public.factory_release_job_order(
  p_job_order_id uuid,
  p_released_by uuid
)
returns void
language plpgsql
security invoker
as $$
declare
  v_job_order public.factory_job_orders%rowtype;
begin
  if not public.current_user_has_permission('factory_job_orders.edit') then
    raise exception 'Missing permission to release Job Orders.';
  end if;

  select * into v_job_order
  from public.factory_job_orders
  where id = p_job_order_id
  for update;

  if v_job_order.id is null then
    raise exception 'Job Order was not found.';
  end if;

  if v_job_order.status <> 'draft' then
    raise exception 'Only Draft Job Orders can be released.';
  end if;

  update public.factory_job_orders
  set status = 'released',
      released_at = now(),
      released_by = p_released_by,
      updated_at = now()
  where id = p_job_order_id;
end;
$$;

grant execute on function public.factory_release_job_order(uuid, uuid) to authenticated;

create or replace function public.factory_start_job_order(
  p_job_order_id uuid,
  p_operator_id uuid,
  p_operator_name text,
  p_production_date date,
  p_start_time time,
  p_remarks text,
  p_started_by uuid
)
returns void
language plpgsql
security invoker
as $$
declare
  v_job_order public.factory_job_orders%rowtype;
begin
  if not public.current_user_has_permission('factory_production.complete') then
    raise exception 'Missing permission to start production.';
  end if;

  select * into v_job_order
  from public.factory_job_orders
  where id = p_job_order_id
  for update;

  if v_job_order.id is null then
    raise exception 'Job Order was not found.';
  end if;

  if v_job_order.status <> 'released' then
    raise exception 'Only Released Job Orders can start production.';
  end if;

  update public.factory_job_orders
  set status = 'in_progress',
      started_at = now(),
      started_by = p_started_by,
      production_operator_id = coalesce(p_operator_id, p_started_by),
      production_operator_name = nullif(trim(coalesce(p_operator_name, '')), ''),
      production_date = coalesce(p_production_date, current_date),
      start_time = p_start_time,
      remarks = case
        when coalesce(trim(p_remarks), '') = '' then remarks
        when coalesce(trim(remarks), '') = '' then trim(p_remarks)
        else remarks || E'\n' || trim(p_remarks)
      end,
      updated_at = now()
  where id = p_job_order_id;
end;
$$;

grant execute on function public.factory_start_job_order(uuid, uuid, text, date, time, text, uuid) to authenticated;

create or replace function public.factory_complete_production(
  p_job_order_id uuid,
  p_finished_good_id uuid,
  p_production_no text,
  p_product_name text,
  p_batch_no text,
  p_production_date date,
  p_operator_id uuid,
  p_operator_name text,
  p_start_time time,
  p_end_time time,
  p_actual_produced_qty numeric,
  p_good_output_qty numeric,
  p_wastage_qty numeric,
  p_uom text,
  p_qc_status text,
  p_production_sop_id uuid,
  p_sop_version text,
  p_notes text,
  p_created_by uuid,
  p_usage_items jsonb
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_production_id uuid;
  v_finished_good public.factory_finished_goods%rowtype;
  v_job_order public.factory_job_orders%rowtype;
  v_usage_item jsonb;
  v_raw_material_id uuid;
  v_raw_material_receiving_id uuid;
  v_standard_usage numeric;
  v_actual_usage numeric;
  v_variance_qty numeric;
  v_variance_percent numeric;
  v_variance_reason text;
  v_production_no text;
  v_product_name text;
  v_uom text;
begin
  if not public.current_user_has_permission('factory_production.complete') then
    raise exception 'Missing permission to complete production.';
  end if;

  if p_job_order_id is null then
    raise exception 'Production must start from a selected Job Order.';
  end if;

  select * into v_job_order
  from public.factory_job_orders
  where id = p_job_order_id
  for update;

  if v_job_order.id is null then
    raise exception 'Job Order was not found.';
  end if;

  if lower(coalesce(v_job_order.status, '')) = 'completed' then
    raise exception 'This Job Order has already been completed.';
  end if;

  if lower(coalesce(v_job_order.status, '')) <> 'in_progress' then
    raise exception 'Only In Progress Job Orders can be completed.';
  end if;

  if exists (
    select 1
    from public.factory_productions production
    where production.job_order_id = p_job_order_id
      and lower(coalesce(production.status, '')) = 'completed'
  ) then
    raise exception 'This Job Order already has a completed production record.';
  end if;

  if p_finished_good_id is null then
    raise exception 'Finished Good is required for production stock-in.';
  end if;

  if v_job_order.finished_good_id is null or v_job_order.finished_good_id <> p_finished_good_id then
    raise exception 'Production Finished Good must match the selected Job Order.';
  end if;

  select * into v_finished_good
  from public.factory_finished_goods
  where id = p_finished_good_id
  for update;

  if v_finished_good.id is null or lower(coalesce(v_finished_good.status, '')) <> 'active' then
    raise exception 'Production can only stock-in to an active Finished Goods master product.';
  end if;

  if coalesce(p_good_output_qty, 0) <= 0 then
    raise exception 'Good output quantity must be greater than 0.';
  end if;

  if coalesce(jsonb_array_length(p_usage_items), 0) = 0 then
    raise exception 'At least one material usage row is required.';
  end if;

  v_product_name := v_finished_good.product_name;
  v_uom := coalesce(nullif(trim(coalesce(p_uom, '')), ''), v_finished_good.uom, v_job_order.uom);
  v_production_no := coalesce(nullif(trim(p_production_no), ''), 'PRD-' || to_char(now(), 'YYYYMMDDHH24MISS'));

  insert into public.factory_productions (
    job_order_id,
    finished_good_id,
    production_no,
    product_name,
    batch_no,
    produced_quantity,
    actual_produced_qty,
    good_output_qty,
    wastage_qty,
    uom,
    production_date,
    operator_id,
    operator_name,
    start_time,
    end_time,
    qc_status,
    production_sop_id,
    sop_version,
    status,
    notes,
    created_by,
    completed_at,
    updated_at
  )
  values (
    p_job_order_id,
    v_finished_good.id,
    v_production_no,
    v_product_name,
    nullif(trim(coalesce(p_batch_no, '')), ''),
    coalesce(p_good_output_qty, 0),
    coalesce(p_actual_produced_qty, 0),
    coalesce(p_good_output_qty, 0),
    coalesce(p_wastage_qty, 0),
    v_uom,
    coalesce(p_production_date, v_job_order.production_date, current_date),
    coalesce(p_operator_id, v_job_order.production_operator_id),
    nullif(trim(coalesce(p_operator_name, v_job_order.production_operator_name, '')), ''),
    coalesce(p_start_time, v_job_order.start_time),
    p_end_time,
    coalesce(nullif(trim(p_qc_status), ''), 'Pending'),
    p_production_sop_id,
    nullif(trim(coalesce(p_sop_version, '')), ''),
    'completed',
    p_notes,
    p_created_by,
    now(),
    now()
  )
  returning id into v_production_id;

  if p_production_sop_id is not null then
    insert into public.factory_production_qc_checkpoints (
      production_id,
      production_sop_id,
      sop_step_id,
      step_no,
      process_name,
      control_point,
      qc_status,
      notes,
      updated_at
    )
    select
      v_production_id,
      p_production_sop_id,
      step.id,
      step.step_no,
      coalesce(nullif(trim(step.process_name), ''), step.instruction),
      step.control_point,
      coalesce(nullif(trim(p_qc_status), ''), 'Pending'),
      'QC checkpoint copied from SOP version used at production completion.',
      now()
    from public.factory_production_sop_steps step
    where step.sop_id = p_production_sop_id
      and step.is_qc_checkpoint = true
    order by step.step_no;
  end if;

  for v_usage_item in
    select value from jsonb_array_elements(p_usage_items)
  loop
    v_raw_material_id := nullif(v_usage_item->>'raw_material_id', '')::uuid;
    v_raw_material_receiving_id := nullif(v_usage_item->>'raw_material_receiving_id', '')::uuid;
    v_standard_usage := coalesce(nullif(v_usage_item->>'standard_usage', '')::numeric, 0);
    v_actual_usage := coalesce(nullif(v_usage_item->>'actual_usage', '')::numeric, 0);
    v_variance_qty := v_actual_usage - v_standard_usage;
    v_variance_percent := case
      when v_standard_usage = 0 then case when v_actual_usage = 0 then 0 else 100 end
      else (v_variance_qty / v_standard_usage) * 100
    end;
    v_variance_reason := nullif(trim(coalesce(v_usage_item->>'variance_reason', '')), '');

    if v_raw_material_id is null then
      raise exception 'Raw material is required for every usage row.';
    end if;

    if v_actual_usage < 0 then
      raise exception 'Actual usage cannot be negative.';
    end if;

    if abs(v_variance_qty) > 0.000001 and v_variance_reason is null then
      raise exception 'Variance reason is required when actual usage differs from standard usage.';
    end if;

    insert into public.factory_production_material_usage (
      production_id,
      raw_material_id,
      raw_material_receiving_id,
      raw_material_lot_no,
      quantity_used,
      standard_usage,
      actual_usage,
      variance_qty,
      variance_percent,
      variance_reason,
      uom,
      wastage_quantity,
      notes,
      updated_at
    )
    values (
      v_production_id,
      v_raw_material_id,
      v_raw_material_receiving_id,
      nullif(trim(coalesce(v_usage_item->>'raw_material_lot_no', '')), ''),
      v_actual_usage,
      v_standard_usage,
      v_actual_usage,
      v_variance_qty,
      v_variance_percent,
      v_variance_reason,
      v_usage_item->>'uom',
      coalesce(nullif(v_usage_item->>'wastage_quantity', '')::numeric, 0),
      v_usage_item->>'notes',
      now()
    );

    if v_actual_usage > 0 then
      perform public.factory_adjust_raw_material_balance(v_raw_material_id, -v_actual_usage);

      insert into public.factory_raw_material_movements (
        raw_material_id,
        movement_type,
        quantity,
        uom,
        reference_type,
        reference_id,
        reference_no,
        movement_date,
        notes,
        created_by
      )
      values (
        v_raw_material_id,
        'Production Usage',
        -v_actual_usage,
        v_usage_item->>'uom',
        'production',
        v_production_id,
        v_production_no,
        coalesce(p_production_date, v_job_order.production_date, current_date),
        case
          when coalesce(v_usage_item->>'raw_material_lot_no', '') <> ''
            then 'Raw material deducted from actual production usage. Lot: ' || (v_usage_item->>'raw_material_lot_no')
          else 'Raw material deducted from actual production usage.'
        end,
        p_created_by
      );
    end if;
  end loop;

  perform public.factory_adjust_finished_good_balance(v_finished_good.id, coalesce(p_good_output_qty, 0));

  insert into public.factory_product_stock_movements (
    finished_good_id,
    product_name,
    movement_type,
    quantity,
    uom,
    reference_type,
    reference_id,
    reference_no,
    movement_date,
    notes,
    created_by
  )
  values (
    v_finished_good.id,
    v_product_name,
    'Production Stock In',
    coalesce(p_good_output_qty, 0),
    v_uom,
    'production',
    v_production_id,
    v_production_no,
    coalesce(p_production_date, v_job_order.production_date, current_date),
    'Finished goods stocked in from completed production.',
    p_created_by
  );

  update public.factory_job_orders
  set status = 'completed',
      produced_quantity = coalesce(p_good_output_qty, 0),
      product_name = v_product_name,
      uom = v_uom,
      completed_at = now(),
      completed_by = p_created_by,
      updated_at = now()
  where id = p_job_order_id
    and status = 'in_progress';

  if not found then
    raise exception 'Unable to complete Job Order because it is no longer in progress.';
  end if;

  return v_production_id;
end;
$$;

grant execute on function public.factory_complete_production(
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  uuid,
  text,
  time,
  time,
  numeric,
  numeric,
  numeric,
  text,
  text,
  uuid,
  text,
  text,
  uuid,
  jsonb
) to authenticated;
