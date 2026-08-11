-- Factory Finished Goods Master and category setup.

create table if not exists public.factory_finished_good_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active',
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.factory_finished_goods
  add column if not exists category_id uuid references public.factory_finished_good_categories(id) on delete set null,
  add column if not exists remarks text;

create unique index if not exists factory_finished_good_categories_lower_name_key
on public.factory_finished_good_categories (lower(name));

grant select, insert, update, delete on public.factory_finished_good_categories to authenticated;

alter table public.factory_finished_good_categories enable row level security;

drop policy if exists "factory finished good categories view" on public.factory_finished_good_categories;
create policy "factory finished good categories view" on public.factory_finished_good_categories for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_finished_goods.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production.complete')
);

drop policy if exists "factory finished good categories manage" on public.factory_finished_good_categories;
create policy "factory finished good categories manage" on public.factory_finished_good_categories for all to authenticated
using (
  public.current_user_has_permission('factory_finished_goods.create')
  or public.current_user_has_permission('factory_finished_goods.edit')
)
with check (
  public.current_user_has_permission('factory_finished_goods.create')
  or public.current_user_has_permission('factory_finished_goods.edit')
);

drop policy if exists "factory finished goods production view" on public.factory_finished_goods;
create policy "factory finished goods production view" on public.factory_finished_goods for select to authenticated
using (public.current_user_has_permission('factory_production.complete'));

drop policy if exists "factory finished goods production stock in" on public.factory_finished_goods;
create policy "factory finished goods production stock in" on public.factory_finished_goods for update to authenticated
using (public.current_user_has_permission('factory_production.complete'))
with check (public.current_user_has_permission('factory_production.complete'));

drop policy if exists "factory product movements production insert" on public.factory_product_stock_movements;
create policy "factory product movements production insert" on public.factory_product_stock_movements for insert to authenticated
with check (public.current_user_has_permission('factory_production.complete'));

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
  v_finished_good_id uuid;
  v_usage_item jsonb;
  v_raw_material_id uuid;
  v_raw_material_receiving_id uuid;
  v_standard_usage numeric;
  v_actual_usage numeric;
  v_variance_qty numeric;
  v_variance_percent numeric;
  v_variance_reason text;
  v_production_no text;
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

  select id into v_finished_good_id
  from public.factory_finished_goods
  where lower(product_name) = lower(trim(p_product_name))
    and lower(status) = 'active'
  limit 1;

  if v_finished_good_id is null then
    raise exception 'Create an active finished good product before production stock-in.';
  end if;

  v_production_no := coalesce(nullif(trim(p_production_no), ''), 'PRD-' || to_char(now(), 'YYYYMMDDHH24MISS'));

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
    v_production_no,
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

    if abs(v_variance_percent) > 5 and v_variance_reason is null then
      raise exception 'Variance reason is required when material variance exceeds 5%%.';
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
      coalesce(p_production_date, current_date),
      case
        when coalesce(v_usage_item->>'raw_material_lot_no', '') <> ''
          then 'Raw material deducted from actual production usage. Lot: ' || (v_usage_item->>'raw_material_lot_no')
        else 'Raw material deducted from actual production usage.'
      end,
      p_created_by
    );
  end loop;

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
    v_production_no,
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
  uuid,
  text,
  text,
  uuid,
  jsonb
) to authenticated;
