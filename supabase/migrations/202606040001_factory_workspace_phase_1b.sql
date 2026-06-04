-- Factory workspace Phase 1B: production execution, actual material usage,
-- raw material deduction, finished goods stock-in and variance tracking.

alter table public.factory_productions
  add column if not exists batch_no text,
  add column if not exists operator_id uuid references public.employees(id),
  add column if not exists operator_name text,
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists actual_produced_qty numeric not null default 0,
  add column if not exists good_output_qty numeric not null default 0,
  add column if not exists wastage_qty numeric not null default 0,
  add column if not exists qc_status text not null default 'Pending',
  add column if not exists completed_at timestamptz;

alter table public.factory_production_material_usage
  add column if not exists standard_usage numeric not null default 0,
  add column if not exists actual_usage numeric not null default 0,
  add column if not exists variance_qty numeric not null default 0,
  add column if not exists variance_percent numeric not null default 0,
  add column if not exists variance_reason text;

create unique index if not exists factory_finished_goods_product_name_key
on public.factory_finished_goods (lower(product_name));

create or replace function public.factory_adjust_finished_good_balance(finished_good_id uuid, quantity_delta numeric)
returns void
language plpgsql
security invoker
as $$
begin
  update public.factory_finished_goods
  set current_balance = coalesce(current_balance, 0) + coalesce(quantity_delta, 0),
      updated_at = now()
  where id = finished_good_id;
end;
$$;

grant execute on function public.factory_adjust_finished_good_balance(uuid, numeric) to authenticated;

create or replace function public.factory_complete_production(
  p_job_order_id uuid,
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
  v_finished_good_id uuid;
  v_usage_item jsonb;
  v_raw_material_id uuid;
  v_standard_usage numeric;
  v_actual_usage numeric;
  v_variance_qty numeric;
  v_variance_percent numeric;
  v_variance_reason text;
begin
  if coalesce(trim(p_product_name), '') = '' then
    raise exception 'Product name is required.';
  end if;

  if coalesce(p_good_output_qty, 0) <= 0 then
    raise exception 'Good output quantity must be greater than 0.';
  end if;

  if coalesce(jsonb_array_length(p_usage_items), 0) = 0 then
    raise exception 'At least one material usage row is required.';
  end if;

  insert into public.factory_productions (
    job_order_id,
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
    status,
    notes,
    created_by,
    completed_at,
    updated_at
  )
  values (
    p_job_order_id,
    coalesce(nullif(trim(p_production_no), ''), 'PRD-' || to_char(now(), 'YYYYMMDDHH24MISS')),
    trim(p_product_name),
    nullif(trim(coalesce(p_batch_no, '')), ''),
    coalesce(p_good_output_qty, 0),
    coalesce(p_actual_produced_qty, 0),
    coalesce(p_good_output_qty, 0),
    coalesce(p_wastage_qty, 0),
    p_uom,
    coalesce(p_production_date, current_date),
    p_operator_id,
    nullif(trim(coalesce(p_operator_name, '')), ''),
    p_start_time,
    p_end_time,
    coalesce(nullif(trim(p_qc_status), ''), 'Pending'),
    'completed',
    p_notes,
    p_created_by,
    now(),
    now()
  )
  returning id into v_production_id;

  for v_usage_item in
    select value from jsonb_array_elements(p_usage_items)
  loop
    v_raw_material_id := nullif(v_usage_item->>'raw_material_id', '')::uuid;
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

    if abs(v_variance_percent) > 5 and v_variance_reason is null then
      raise exception 'Variance reason is required when material variance exceeds 5%%.';
    end if;

    insert into public.factory_production_material_usage (
      production_id,
      raw_material_id,
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
      p_production_no,
      coalesce(p_production_date, current_date),
      'Raw material deducted from actual production usage.',
      p_created_by
    );
  end loop;

  select id into v_finished_good_id
  from public.factory_finished_goods
  where lower(product_name) = lower(trim(p_product_name))
  limit 1;

  if v_finished_good_id is null then
    insert into public.factory_finished_goods (
      product_name,
      uom,
      current_balance,
      status,
      created_by,
      updated_at
    )
    values (
      trim(p_product_name),
      p_uom,
      0,
      'active',
      p_created_by,
      now()
    )
    returning id into v_finished_good_id;
  end if;

  perform public.factory_adjust_finished_good_balance(v_finished_good_id, coalesce(p_good_output_qty, 0));

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
    v_finished_good_id,
    trim(p_product_name),
    'Production Stock In',
    coalesce(p_good_output_qty, 0),
    p_uom,
    'production',
    v_production_id,
    p_production_no,
    coalesce(p_production_date, current_date),
    'Finished goods stocked in from completed production.',
    p_created_by
  );

  if p_job_order_id is not null then
    update public.factory_job_orders
    set status = 'completed',
        produced_quantity = coalesce(p_good_output_qty, 0),
        updated_at = now()
    where id = p_job_order_id;
  end if;

  return v_production_id;
end;
$$;

grant execute on function public.factory_complete_production(
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
  text,
  uuid,
  jsonb
) to authenticated;

drop policy if exists "factory raw materials update" on public.factory_raw_materials;
create policy "factory raw materials update" on public.factory_raw_materials for update to authenticated
using (
  public.current_user_has_permission('factory_raw_inventory.edit')
  or public.current_user_has_permission('factory_raw_receiving.create')
  or public.current_user_has_permission('factory_raw_receiving.edit')
  or public.current_user_has_permission('factory_production.complete')
)
with check (
  public.current_user_has_permission('factory_raw_inventory.edit')
  or public.current_user_has_permission('factory_raw_receiving.create')
  or public.current_user_has_permission('factory_raw_receiving.edit')
  or public.current_user_has_permission('factory_production.complete')
);

drop policy if exists "factory raw movements insert" on public.factory_raw_material_movements;
create policy "factory raw movements insert" on public.factory_raw_material_movements for insert to authenticated
with check (
  public.current_user_has_permission('factory_raw_receiving.create')
  or public.current_user_has_permission('factory_raw_receiving.edit')
  or public.current_user_has_permission('factory_raw_inventory.edit')
  or public.current_user_has_permission('factory_production.complete')
);

drop policy if exists "factory production usage manage" on public.factory_production_material_usage;
create policy "factory production usage manage" on public.factory_production_material_usage for all to authenticated
using (
  public.current_user_has_permission('factory_production.edit')
  or public.current_user_has_permission('factory_production.create')
  or public.current_user_has_permission('factory_production.complete')
)
with check (
  public.current_user_has_permission('factory_production.edit')
  or public.current_user_has_permission('factory_production.create')
  or public.current_user_has_permission('factory_production.complete')
);

drop policy if exists "factory product movements manage" on public.factory_product_stock_movements;
create policy "factory product movements manage" on public.factory_product_stock_movements for all to authenticated
using (
  public.current_user_has_permission('factory_product_movements.create')
  or public.current_user_has_permission('factory_product_movements.edit')
  or public.current_user_has_permission('factory_production.complete')
)
with check (
  public.current_user_has_permission('factory_product_movements.create')
  or public.current_user_has_permission('factory_product_movements.edit')
  or public.current_user_has_permission('factory_production.complete')
);

drop policy if exists "factory finished goods manage" on public.factory_finished_goods;
create policy "factory finished goods manage" on public.factory_finished_goods for all to authenticated
using (
  public.current_user_has_permission('factory_finished_goods.create')
  or public.current_user_has_permission('factory_finished_goods.edit')
  or public.current_user_has_permission('factory_production.complete')
)
with check (
  public.current_user_has_permission('factory_finished_goods.create')
  or public.current_user_has_permission('factory_finished_goods.edit')
  or public.current_user_has_permission('factory_production.complete')
);
