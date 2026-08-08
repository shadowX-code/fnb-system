-- Close the remaining Factory authority bypasses without changing stock formulas.

create or replace function public.factory_current_active_employee_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_employee_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  select employee.id
  into v_employee_id
  from public.employees employee
  where employee.auth_user_id = auth.uid()
    and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id
  limit 1;

  if v_employee_id is null then
    raise exception using errcode = '42501', message = 'An active employee profile is required.';
  end if;
  return v_employee_id;
end;
$$;

create or replace function public.factory_current_active_employee_name()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  perform public.factory_current_active_employee_id();
  select coalesce(
    nullif(btrim(employee.nickname), ''),
    nullif(btrim(employee.full_name), ''),
    nullif(btrim(employee.email), ''),
    'Employee'
  )
  into v_name
  from public.employees employee
  where employee.auth_user_id = auth.uid()
    and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id
  limit 1;
  return v_name;
end;
$$;

revoke all on function public.factory_current_active_employee_id() from public, anon, authenticated;
revoke all on function public.factory_current_active_employee_name() from public, anon, authenticated;

-- Aggregate balances may only be changed inside trusted SECURITY DEFINER
-- lifecycle functions. Master-data users retain access to non-balance columns.
revoke execute on function public.factory_adjust_finished_good_balance(uuid, numeric)
from public, anon, authenticated;
revoke execute on function public.factory_adjust_raw_material_balance(uuid, numeric)
from public, anon, authenticated;

revoke insert, update, delete on table public.factory_finished_goods from anon;
revoke insert, update, delete on table public.factory_raw_materials from anon;
revoke update on table public.factory_finished_goods from authenticated;
revoke update on table public.factory_raw_materials from authenticated;

do $migration$
declare
  v_columns text;
begin
  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
  into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'factory_finished_goods'
    and column_name <> 'current_balance'
    and is_generated = 'NEVER';
  execute format('grant update (%s) on table public.factory_finished_goods to authenticated', v_columns);

  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
  into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'factory_raw_materials'
    and column_name <> 'current_balance'
    and is_generated = 'NEVER';
  execute format('grant update (%s) on table public.factory_raw_materials to authenticated', v_columns);
end;
$migration$;

create or replace function public.factory_guard_direct_aggregate_balance_write()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') and (
    (tg_op = 'INSERT' and coalesce(new.current_balance, 0) <> 0)
    or (tg_op = 'UPDATE' and new.current_balance is distinct from old.current_balance)
  ) then
    raise exception using errcode = '42501',
      message = 'Inventory balances may only be changed through an authorized Factory lifecycle.';
  end if;
  return new;
end;
$$;

drop trigger if exists factory_guard_finished_good_balance_write on public.factory_finished_goods;
create trigger factory_guard_finished_good_balance_write
before insert or update of current_balance on public.factory_finished_goods
for each row execute function public.factory_guard_direct_aggregate_balance_write();

drop trigger if exists factory_guard_raw_material_balance_write on public.factory_raw_materials;
create trigger factory_guard_raw_material_balance_write
before insert or update of current_balance on public.factory_raw_materials
for each row execute function public.factory_guard_direct_aggregate_balance_write();

revoke execute on function public.factory_guard_direct_aggregate_balance_write()
from public, anon, authenticated;

-- Movement ledgers are read-only to clients. Trusted lifecycle functions retain
-- owner-level insert authority.
revoke insert, update, delete on table public.factory_product_stock_movements from anon, authenticated;
revoke insert, update, delete on table public.factory_raw_material_movements from anon, authenticated;
drop policy if exists "factory product movements manage" on public.factory_product_stock_movements;
drop policy if exists "factory product movements production insert" on public.factory_product_stock_movements;
drop policy if exists "factory raw material movements manage" on public.factory_raw_material_movements;
drop policy if exists "factory raw movements manage" on public.factory_raw_material_movements;
drop policy if exists "factory raw movements insert" on public.factory_raw_material_movements;

delete from public.role_permissions role_permission
using public.permissions permission
where role_permission.permission_id = permission.id
  and permission.code in (
    'factory_product_movements.create',
    'factory_product_movements.edit',
    'factory_product_movements.delete'
  );
delete from public.permissions permission
where permission.code in (
  'factory_product_movements.create',
  'factory_product_movements.edit',
  'factory_product_movements.delete'
);

-- Raw Material Stock Check structure is now written only by these transactional
-- RPCs. Client rows never supply system balance, variance, status, or actor.
create or replace function public.factory_save_raw_material_stock_check_structure(
  p_stock_check_id uuid,
  p_category_id uuid,
  p_check_date date,
  p_notes text,
  p_target_status text,
  p_rows jsonb
)
returns table (id uuid, check_no text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := public.factory_current_active_employee_id();
  v_check public.factory_raw_material_stock_checks%rowtype;
  v_check_id uuid;
  v_check_no text;
  v_status text := lower(coalesce(nullif(btrim(p_target_status), ''), 'draft'));
  v_row jsonb;
  v_material public.factory_raw_materials%rowtype;
  v_material_id uuid;
  v_system_qty numeric;
  v_physical_qty numeric;
  v_variance_qty numeric;
  v_variance_percent numeric;
  v_variance_status text;
  v_count_status text;
  v_reason text;
begin
  if v_status not in ('draft', 'submitted') then
    raise exception 'Raw Material Stock Check status must be Draft or Submitted.';
  end if;
  if p_category_id is null or not exists (
    select 1 from public.factory_raw_material_categories category where category.id = p_category_id
  ) then
    raise exception 'Select a valid Raw Material category.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Raw Material Stock Check requires at least one item.';
  end if;
  if v_status = 'submitted'
     and not public.current_user_has_permission('factory_raw_stock_check.submit') then
    raise exception using errcode = '42501', message = 'Insufficient permission to submit Raw Material Stock Check.';
  end if;

  if p_stock_check_id is null then
    if not public.current_user_has_permission('factory_raw_stock_check.create') then
      raise exception using errcode = '42501', message = 'Insufficient permission to create Raw Material Stock Check.';
    end if;
    insert into public.factory_raw_material_stock_checks (
      check_date, category_id, status, notes, created_by, created_at, updated_at
    ) values (
      coalesce(p_check_date, timezone('Asia/Kuala_Lumpur', now())::date),
      p_category_id, 'draft', coalesce(p_notes, ''), v_actor_id, now(), now()
    ) returning factory_raw_material_stock_checks.id,
        factory_raw_material_stock_checks.check_no
      into v_check_id, v_check_no;
  else
    if not (
      public.current_user_has_permission('factory_raw_stock_check.edit')
      or (v_status = 'submitted' and public.current_user_has_permission('factory_raw_stock_check.submit'))
    ) then
      raise exception using errcode = '42501', message = 'Insufficient permission to edit Raw Material Stock Check.';
    end if;
    select stock_check.* into v_check
    from public.factory_raw_material_stock_checks stock_check
    where stock_check.id = p_stock_check_id
    for update;
    if v_check.id is null then raise exception 'Raw Material Stock Check was not found.'; end if;
    if lower(coalesce(v_check.status, '')) <> 'draft' then
      raise exception 'Only Draft Raw Material Stock Checks can be edited or submitted.';
    end if;
    v_check_id := v_check.id;
    v_check_no := v_check.check_no;
    update public.factory_raw_material_stock_checks stock_check
    set check_date = coalesce(p_check_date, stock_check.check_date),
        category_id = p_category_id,
        notes = coalesce(p_notes, ''),
        updated_at = now()
    where stock_check.id = v_check_id;
  end if;

  delete from public.factory_raw_material_stock_check_items item
  where item.stock_check_id = v_check_id;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_material_id := nullif(v_row ->> 'raw_material_id', '')::uuid;
    if exists (
      select 1 from public.factory_raw_material_stock_check_items item
      where item.stock_check_id = v_check_id and item.raw_material_id = v_material_id
    ) then
      raise exception 'Raw Material appears more than once in this Stock Check.';
    end if;
    select material.* into v_material
    from public.factory_raw_materials material
    where material.id = v_material_id
      and material.category_id = p_category_id
      and lower(coalesce(material.status, '')) = 'active'
    for update;
    if v_material.id is null then
      raise exception 'Every Stock Check row requires an active Raw Material in the selected category.';
    end if;

    v_system_qty := coalesce(v_material.current_balance, 0);
    v_count_status := lower(coalesce(nullif(btrim(v_row ->> 'count_status'), ''),
      case when nullif(v_row ->> 'physical_qty', '') is null then 'pending' else 'counted' end));
    if v_count_status not in ('pending', 'counted', 'skip', 'skipped') then
      raise exception 'Raw Material Stock Check count status is invalid.';
    end if;
    if v_count_status in ('skip', 'skipped') then
      v_count_status := 'skip';
      v_physical_qty := v_system_qty;
    elsif nullif(v_row ->> 'physical_qty', '') is null then
      v_count_status := 'pending';
      v_physical_qty := v_system_qty;
    else
      v_count_status := 'counted';
      v_physical_qty := (v_row ->> 'physical_qty')::numeric;
      if v_physical_qty < 0 then raise exception 'Physical count cannot be negative.'; end if;
    end if;

    v_variance_qty := case when v_count_status = 'counted' then v_physical_qty - v_system_qty else 0 end;
    v_variance_percent := case when v_system_qty > 0 then (v_variance_qty / v_system_qty) * 100 else 0 end;
    v_variance_status := case
      when v_count_status = 'skip' then 'Skipped'
      when v_variance_qty = 0 then 'Normal'
      when v_system_qty <= 0 or abs(v_variance_percent) >= 5 then 'Critical'
      else 'Variance'
    end;
    v_reason := nullif(btrim(coalesce(v_row ->> 'variance_reason', '')), '');

    if v_status = 'submitted' and v_count_status = 'pending' then
      raise exception 'Submit requires every Raw Material Stock Check row to be counted or skipped.';
    end if;
    if v_status = 'submitted' and v_count_status = 'skip' and v_reason is null then
      raise exception 'Skip reason is required for skipped Raw Material Stock Check rows.';
    end if;
    if v_status = 'submitted' and v_count_status = 'counted'
       and v_variance_qty <> 0 and v_reason is null then
      raise exception 'Variance reason is required for Raw Material Stock Check adjustments.';
    end if;

    insert into public.factory_raw_material_stock_check_items (
      stock_check_id, raw_material_id, system_qty, physical_qty, variance_qty,
      variance_percent, count_status, variance_status, variance_reason, uom,
      created_at, updated_at
    ) values (
      v_check_id, v_material.id, v_system_qty, v_physical_qty, v_variance_qty,
      v_variance_percent, v_count_status, v_variance_status, coalesce(v_reason, ''),
      v_material.uom, now(), now()
    );
  end loop;

  if v_status = 'submitted' then
    update public.factory_raw_material_stock_checks stock_check
    set status = 'submitted', submitted_by = v_actor_id, submitted_at = now(), updated_at = now()
    where stock_check.id = v_check_id and lower(stock_check.status) = 'draft';
    if not found then raise exception 'Raw Material Stock Check is no longer Draft.'; end if;
  end if;

  return query select v_check_id, v_check_no;
end;
$$;

create or replace function public.factory_delete_raw_material_stock_check_draft(
  p_stock_check_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_check public.factory_raw_material_stock_checks%rowtype;
begin
  perform public.factory_current_active_employee_id();
  if not public.current_user_has_permission('factory_raw_stock_check.delete') then
    raise exception using errcode = '42501', message = 'Insufficient permission to delete Raw Material Stock Check.';
  end if;
  select stock_check.* into v_check
  from public.factory_raw_material_stock_checks stock_check
  where stock_check.id = p_stock_check_id
  for update;
  if v_check.id is null then raise exception 'Raw Material Stock Check was not found.'; end if;
  if lower(coalesce(v_check.status, '')) <> 'draft' then
    raise exception 'Only Draft Raw Material Stock Checks can be deleted.';
  end if;
  if exists (
    select 1 from public.factory_raw_material_movements movement
    where movement.reference_type = 'raw_material_stock_check'
      and movement.reference_id = v_check.id
  ) or exists (
    select 1 from public.factory_raw_material_stock_check_batch_allocations allocation
    join public.factory_raw_material_stock_check_items item on item.id = allocation.stock_check_item_id
    where item.stock_check_id = v_check.id
  ) then
    raise exception 'Draft Raw Material Stock Check cannot be deleted because inventory history exists.';
  end if;
  delete from public.factory_raw_material_stock_checks stock_check where stock_check.id = v_check.id;
  return v_check.id;
end;
$$;

revoke insert, update, delete on table public.factory_raw_material_stock_checks from anon, authenticated;
revoke insert, update, delete on table public.factory_raw_material_stock_check_items from anon, authenticated;
drop policy if exists "factory raw stock checks manage" on public.factory_raw_material_stock_checks;
drop policy if exists "factory raw stock check items manage" on public.factory_raw_material_stock_check_items;

revoke all on function public.factory_create_raw_material_stock_check(uuid, date, text, jsonb)
from public, anon, authenticated;
revoke all on function public.factory_create_raw_material_stock_check_business_no_v1(uuid, date, text, jsonb)
from public, anon, authenticated;
revoke all on function public.factory_save_raw_material_stock_check_structure(uuid, uuid, date, text, text, jsonb)
from public, anon;
grant execute on function public.factory_save_raw_material_stock_check_structure(uuid, uuid, date, text, text, jsonb)
to authenticated;
revoke all on function public.factory_delete_raw_material_stock_check_draft(uuid)
from public, anon;
grant execute on function public.factory_delete_raw_material_stock_check_draft(uuid)
to authenticated;

-- Compatibility signatures remain callable, but their client actor parameters
-- are ignored. The effective function bodies resolve the actor from auth.uid().
do $migration$
declare
  v_patch record;
  v_function regprocedure;
  v_definition text;
  v_marker integer;
  v_body text;
begin
  for v_patch in
    select * from (values
      ('public.factory_save_product_stock_check_structure_business_no_v1(uuid,date,text,text,uuid,jsonb)', 'p_created_by', 'public.factory_current_active_employee_id()'),
      ('public.factory_approve_product_stock_check(uuid,uuid)', 'p_approved_by', 'public.factory_current_active_employee_id()'),
      ('public.factory_start_job_order(uuid,uuid,text,date,time without time zone,text,uuid)', 'p_started_by', 'public.factory_current_active_employee_id()'),
      ('public.factory_save_production_qc_progress(uuid,jsonb,jsonb,uuid,text)', 'p_actor_id', 'public.factory_current_active_employee_id()'),
      ('public.factory_save_production_qc_progress(uuid,jsonb,jsonb,uuid,text)', 'p_actor_name', 'public.factory_current_active_employee_name()'),
      ('public.factory_create_qc_checklist_template(text,text,text,uuid)', 'p_created_by', 'public.factory_current_active_employee_id()'),
      ('public.factory_save_production_sop_structure(uuid,uuid,text,date,text,uuid,text,jsonb,uuid)', 'p_created_by', 'public.factory_current_active_employee_id()'),
      ('public.factory_create_production_sop_new_version(uuid)', 'v_source.created_by', 'public.factory_current_active_employee_id()')
    ) patch(signature, old_token, new_expression)
  loop
    v_function := to_regprocedure(v_patch.signature);
    if v_function is null then raise exception 'Required Factory authority function is missing: %', v_patch.signature; end if;
    select pg_get_functiondef(v_function::oid) into v_definition;
    v_marker := position('AS $function$' in v_definition);
    if v_marker = 0 then raise exception 'Unable to locate function body for %.', v_patch.signature; end if;
    v_marker := v_marker + length('AS $function$');
    v_body := substring(v_definition from v_marker);
    if position(v_patch.old_token in v_body) = 0 then
      if position(v_patch.new_expression in v_body) > 0 then
        continue;
      end if;
      raise exception 'Expected actor authority token was not found in %.', v_patch.signature;
    end if;
    v_definition := left(v_definition, v_marker - 1)
      || replace(v_body, v_patch.old_token, v_patch.new_expression);
    execute v_definition;
  end loop;
end;
$migration$;

revoke execute on function public.factory_save_product_stock_check_structure_business_no_v1(uuid, date, text, text, uuid, jsonb)
from public, anon, authenticated;
alter function public.factory_save_product_stock_check_structure(uuid, date, text, text, uuid, jsonb)
security definer;
revoke execute on function public.factory_approve_product_stock_check(uuid, uuid) from public, anon;
grant execute on function public.factory_approve_product_stock_check(uuid, uuid) to authenticated;
revoke execute on function public.factory_start_job_order(uuid, uuid, text, date, time, text, uuid) from public, anon;
grant execute on function public.factory_start_job_order(uuid, uuid, text, date, time, text, uuid) to authenticated;
revoke execute on function public.factory_save_production_qc_progress(uuid, jsonb, jsonb, uuid, text) from public, anon;
grant execute on function public.factory_save_production_qc_progress(uuid, jsonb, jsonb, uuid, text) to authenticated;
revoke execute on function public.factory_create_qc_checklist_template(text, text, text, uuid) from public, anon;
grant execute on function public.factory_create_qc_checklist_template(text, text, text, uuid) to authenticated;
revoke execute on function public.factory_save_production_sop_structure(uuid, uuid, text, date, text, uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.factory_save_production_sop_structure(uuid, uuid, text, date, text, uuid, text, jsonb, uuid) to authenticated;

-- The public FG Stock Check wrapper remains the only structure-save entrypoint.
revoke execute on function public.factory_save_product_stock_check_structure(uuid, date, text, text, uuid, jsonb)
from public, anon;
grant execute on function public.factory_save_product_stock_check_structure(uuid, date, text, text, uuid, jsonb)
to authenticated;
