-- Freeze the operator-facing Factory business-number standard for new records.
-- Historical identifiers remain unchanged.

create or replace function public.factory_format_business_sequence(p_sequence integer)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select case
    when p_sequence < 10 then '0' || p_sequence::text
    else p_sequence::text
  end;
$$;

do $$
begin
  if public.factory_format_business_sequence(1) <> '01'
     or public.factory_format_business_sequence(9) <> '09'
     or public.factory_format_business_sequence(10) <> '10'
     or public.factory_format_business_sequence(99) <> '99'
     or public.factory_format_business_sequence(100) <> '100'
     or public.factory_format_business_sequence(101) <> '101' then
    raise exception 'Factory business sequence formatting verification failed.';
  end if;
end;
$$;

create or replace function public.factory_set_job_order_business_no()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_business_date date := timezone('Asia/Kuala_Lumpur', now())::date;
  v_yymmdd text;
  v_prefix text;
  v_next integer;
begin
  v_yymmdd := to_char(v_business_date, 'YYMMDD');
  v_prefix := 'JO' || v_yymmdd;

  perform pg_advisory_xact_lock(
    hashtextextended('factory_job_order:JO:' || v_yymmdd, 0)
  );

  select coalesce(
    max((substring(job.job_order_no from ('^' || v_prefix || '-([0-9]+)$')))::integer),
    0
  ) + 1
  into v_next
  from public.factory_job_orders job
  where job.job_order_no ~ ('^' || v_prefix || '-[0-9]+$');

  new.job_order_no := v_prefix || '-' || public.factory_format_business_sequence(v_next);
  return new;
end;
$$;

drop trigger if exists factory_set_job_order_business_no_before_insert
  on public.factory_job_orders;
create trigger factory_set_job_order_business_no_before_insert
before insert on public.factory_job_orders
for each row execute function public.factory_set_job_order_business_no();

create or replace function public.factory_set_production_batch_business_no()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_date date := coalesce(new.production_date, timezone('Asia/Kuala_Lumpur', now())::date);
  v_prefix text := 'PB' || to_char(v_date, 'YYMMDD');
  v_next integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('factory_production_batch:' || v_prefix, 0));
  select coalesce(max((substring(production.batch_no from ('^' || v_prefix || '-([0-9]+)$')))::integer), 0) + 1
  into v_next from public.factory_productions production
  where production.batch_no ~ ('^' || v_prefix || '-[0-9]+$');
  new.batch_no := v_prefix || '-' || public.factory_format_business_sequence(v_next);
  return new;
end;
$$;

drop trigger if exists factory_set_production_batch_no_before_insert
  on public.factory_productions;
create trigger factory_set_production_batch_no_before_insert
before insert on public.factory_productions
for each row execute function public.factory_set_production_batch_business_no();

create or replace function public.factory_set_raw_receiving_business_no()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_date date := coalesce(new.received_date, timezone('Asia/Kuala_Lumpur', now())::date);
  v_prefix text := 'R' || to_char(v_date, 'YYMMDD');
  v_next integer;
begin
  perform pg_advisory_xact_lock(hashtext('factory_raw_receiving:' || v_prefix));
  select coalesce(max((substring(receiving.batch_no from ('^' || v_prefix || '-([0-9]+)$')))::integer), 0) + 1
  into v_next from public.factory_raw_material_receiving_batches receiving
  where receiving.batch_no ~ ('^' || v_prefix || '-[0-9]+$');
  new.batch_no := v_prefix || '-' || public.factory_format_business_sequence(v_next);
  return new;
end;
$$;

drop trigger if exists factory_set_raw_receiving_business_no_before_insert
  on public.factory_raw_material_receiving_batches;
create trigger factory_set_raw_receiving_business_no_before_insert
before insert on public.factory_raw_material_receiving_batches
for each row execute function public.factory_set_raw_receiving_business_no();

create or replace function public.factory_set_dispatch_business_no()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_date date := coalesce(new.dispatch_date, timezone('Asia/Kuala_Lumpur', now())::date);
  v_prefix text := 'D' || to_char(v_date, 'YYMMDD');
  v_next integer;
begin
  perform pg_advisory_xact_lock(hashtext('factory_dispatch_' || v_prefix));
  select coalesce(max((substring(dispatch.dispatch_no from ('^' || v_prefix || '-([0-9]+)$')))::integer), 0) + 1
  into v_next from public.factory_finished_good_dispatches dispatch
  where dispatch.dispatch_no ~ ('^' || v_prefix || '-[0-9]+$');
  new.dispatch_no := v_prefix || '-' || public.factory_format_business_sequence(v_next);
  return new;
end;
$$;

drop trigger if exists factory_set_dispatch_business_no_before_insert
  on public.factory_finished_good_dispatches;
create trigger factory_set_dispatch_business_no_before_insert
before insert on public.factory_finished_good_dispatches
for each row execute function public.factory_set_dispatch_business_no();

create or replace function public.factory_set_product_stock_check_business_no()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_date date := coalesce(new.check_date, timezone('Asia/Kuala_Lumpur', now())::date);
  v_prefix text := 'FGSC' || to_char(v_date, 'YYMMDD');
  v_next integer;
begin
  perform pg_advisory_xact_lock(hashtext('factory_product_stock_check_' || v_prefix));
  select coalesce(max((substring(stock_check.check_no from ('^' || v_prefix || '-([0-9]+)$')))::integer), 0) + 1
  into v_next from public.factory_product_stock_checks stock_check
  where stock_check.check_no ~ ('^' || v_prefix || '-[0-9]+$');
  new.check_no := v_prefix || '-' || public.factory_format_business_sequence(v_next);
  return new;
end;
$$;

drop trigger if exists factory_set_product_stock_check_business_no_before_insert
  on public.factory_product_stock_checks;
create trigger factory_set_product_stock_check_business_no_before_insert
before insert on public.factory_product_stock_checks
for each row execute function public.factory_set_product_stock_check_business_no();

create or replace function public.factory_set_raw_stock_check_business_no()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_date date := coalesce(new.check_date, timezone('Asia/Kuala_Lumpur', now())::date);
  v_yymmdd text := to_char(v_date, 'YYMMDD');
  v_prefix text := 'RMSC-' || v_yymmdd;
  v_next integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('factory_raw_material_stock_check:RMSC:' || v_yymmdd, 0));
  select coalesce(max((substring(stock_check.check_no from ('^' || v_prefix || '-([0-9]+)$')))::integer), 0) + 1
  into v_next from public.factory_raw_material_stock_checks stock_check
  where stock_check.check_no ~ ('^' || v_prefix || '-[0-9]+$');
  new.check_no := v_prefix || '-' || public.factory_format_business_sequence(v_next);
  return new;
end;
$$;

drop trigger if exists factory_set_raw_stock_check_business_no_before_insert
  on public.factory_raw_material_stock_checks;
create trigger factory_set_raw_stock_check_business_no_before_insert
before insert on public.factory_raw_material_stock_checks
for each row execute function public.factory_set_raw_stock_check_business_no();

-- Keep the existing transactional Stock Check implementations intact, but return
-- the number actually written by the canonical before-insert trigger.
do $$
begin
  if to_regprocedure(
    'public.factory_save_product_stock_check_structure_business_no_v1(uuid,date,text,text,uuid,jsonb)'
  ) is null then
    alter function public.factory_save_product_stock_check_structure(
      uuid, date, text, text, uuid, jsonb
    ) rename to factory_save_product_stock_check_structure_business_no_v1;
  end if;
end;
$$;

create or replace function public.factory_save_product_stock_check_structure(
  p_stock_check_id uuid,
  p_check_date date,
  p_notes text,
  p_target_status text,
  p_created_by uuid,
  p_rows jsonb
)
returns table (id uuid, check_no text)
language sql
security invoker
set search_path = public
as $$
  with saved as (
    select result.id
    from public.factory_save_product_stock_check_structure_business_no_v1(
      p_stock_check_id, p_check_date, p_notes, p_target_status, p_created_by, p_rows
    ) result
  )
  select saved.id, stock_check.check_no
  from saved
  join public.factory_product_stock_checks stock_check on stock_check.id = saved.id;
$$;

revoke all on function public.factory_save_product_stock_check_structure_business_no_v1(
  uuid, date, text, text, uuid, jsonb
) from public, anon;
grant execute on function public.factory_save_product_stock_check_structure_business_no_v1(
  uuid, date, text, text, uuid, jsonb
) to authenticated;
revoke all on function public.factory_save_product_stock_check_structure(
  uuid, date, text, text, uuid, jsonb
) from public, anon;
grant execute on function public.factory_save_product_stock_check_structure(
  uuid, date, text, text, uuid, jsonb
) to authenticated;

do $$
begin
  if to_regprocedure(
    'public.factory_create_raw_material_stock_check_business_no_v1(uuid,date,text,jsonb)'
  ) is null then
    alter function public.factory_create_raw_material_stock_check(
      uuid, date, text, jsonb
    ) rename to factory_create_raw_material_stock_check_business_no_v1;
  end if;
end;
$$;

create or replace function public.factory_create_raw_material_stock_check(
  p_category_id uuid,
  p_check_date date,
  p_notes text,
  p_rows jsonb
)
returns table (id uuid, check_no text)
language sql
security invoker
set search_path = public
as $$
  with saved as (
    select result.id
    from public.factory_create_raw_material_stock_check_business_no_v1(
      p_category_id, p_check_date, p_notes, p_rows
    ) result
  )
  select saved.id, stock_check.check_no
  from saved
  join public.factory_raw_material_stock_checks stock_check on stock_check.id = saved.id;
$$;

revoke all on function public.factory_create_raw_material_stock_check_business_no_v1(
  uuid, date, text, jsonb
) from public, anon;
grant execute on function public.factory_create_raw_material_stock_check_business_no_v1(
  uuid, date, text, jsonb
) to authenticated;
revoke all on function public.factory_create_raw_material_stock_check(
  uuid, date, text, jsonb
) from public, anon;
grant execute on function public.factory_create_raw_material_stock_check(
  uuid, date, text, jsonb
) to authenticated;

create or replace function public.factory_raw_receiving_next_internal_batch_no(
  p_raw_material_id uuid,
  p_received_date date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_date date := coalesce(p_received_date, timezone('Asia/Kuala_Lumpur', now())::date);
  v_prefix text;
  v_next integer;
begin
  select upper(regexp_replace(
    coalesce(nullif(btrim(material.material_code), ''), 'MATERIAL'),
    '[^A-Za-z0-9]+',
    '',
    'g'
  ))
  into v_code
  from public.factory_raw_materials material
  where material.id = p_raw_material_id;

  if not found then
    raise exception 'Raw Material not found.';
  end if;

  v_prefix := 'RM-' || v_code || '-' || to_char(v_date, 'YYMMDD') || '-';
  perform pg_advisory_xact_lock(hashtext('factory_raw_batch:' || v_prefix));

  select coalesce(
    max(substring(item.internal_batch_no from length(v_prefix) + 1)::integer),
    0
  ) + 1
  into v_next
  from public.factory_raw_material_receivings item
  where item.internal_batch_no like v_prefix || '%'
    and substring(item.internal_batch_no from length(v_prefix) + 1) ~ '^[0-9]+$';

  return v_prefix || public.factory_format_business_sequence(v_next);
end;
$$;

revoke all on function public.factory_raw_receiving_next_internal_batch_no(uuid, date)
from public, anon, authenticated;

create or replace function public.factory_preview_job_order_no()
returns text
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_yymmdd text := to_char(timezone('Asia/Kuala_Lumpur', now())::date, 'YYMMDD');
  v_prefix text;
  v_next integer;
begin
  if auth.uid() is null
     or not public.current_user_has_permission('factory_job_orders.create') then
    raise exception using errcode = '42501', message = 'Insufficient permission to preview a Job Order number.';
  end if;

  v_prefix := 'JO' || v_yymmdd;
  select coalesce(max((substring(job.job_order_no from ('^' || v_prefix || '-([0-9]+)$')))::integer), 0) + 1
  into v_next
  from public.factory_job_orders job
  where job.job_order_no ~ ('^' || v_prefix || '-[0-9]+$');

  return v_prefix || '-' || public.factory_format_business_sequence(v_next);
end;
$$;

create or replace function public.factory_preview_production_batch_no(
  p_production_date date
)
returns text
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_date date := coalesce(p_production_date, timezone('Asia/Kuala_Lumpur', now())::date);
  v_prefix text;
  v_next integer;
begin
  if auth.uid() is null
     or not (
       public.current_user_has_permission('factory_production.create')
       or public.current_user_has_permission('factory_production.complete')
     ) then
    raise exception using errcode = '42501', message = 'Insufficient permission to preview a Production Batch number.';
  end if;

  v_prefix := 'PB' || to_char(v_date, 'YYMMDD');
  select coalesce(max((substring(production.batch_no from ('^' || v_prefix || '-([0-9]+)$')))::integer), 0) + 1
  into v_next
  from public.factory_productions production
  where production.batch_no ~ ('^' || v_prefix || '-[0-9]+$');

  return v_prefix || '-' || public.factory_format_business_sequence(v_next);
end;
$$;

create or replace function public.factory_preview_raw_material_receiving_no(
  p_received_date date
)
returns text
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_date date := coalesce(p_received_date, timezone('Asia/Kuala_Lumpur', now())::date);
  v_prefix text;
  v_next integer;
begin
  if auth.uid() is null
     or not public.current_user_has_permission('factory_raw_receiving.create') then
    raise exception using errcode = '42501', message = 'Insufficient permission to preview a Receiving number.';
  end if;

  v_prefix := 'R' || to_char(v_date, 'YYMMDD');
  select coalesce(max((substring(receiving.batch_no from ('^' || v_prefix || '-([0-9]+)$')))::integer), 0) + 1
  into v_next
  from public.factory_raw_material_receiving_batches receiving
  where receiving.batch_no ~ ('^' || v_prefix || '-[0-9]+$');

  return v_prefix || '-' || public.factory_format_business_sequence(v_next);
end;
$$;

create or replace function public.factory_preview_product_stock_check_no(
  p_check_date date
)
returns text
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_date date := coalesce(p_check_date, timezone('Asia/Kuala_Lumpur', now())::date);
  v_prefix text;
  v_next integer;
begin
  if auth.uid() is null
     or not public.current_user_has_permission('factory_product_stock_check.create') then
    raise exception using errcode = '42501', message = 'Insufficient permission to preview a Finished Goods Stock Check number.';
  end if;

  v_prefix := 'FGSC' || to_char(v_date, 'YYMMDD');
  select coalesce(max((substring(stock_check.check_no from ('^' || v_prefix || '-([0-9]+)$')))::integer), 0) + 1
  into v_next
  from public.factory_product_stock_checks stock_check
  where stock_check.check_no ~ ('^' || v_prefix || '-[0-9]+$');

  return v_prefix || '-' || public.factory_format_business_sequence(v_next);
end;
$$;

create or replace function public.factory_preview_raw_material_stock_check_no(
  p_check_date date
)
returns text
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_date date := coalesce(p_check_date, timezone('Asia/Kuala_Lumpur', now())::date);
  v_prefix text;
  v_next integer;
begin
  if auth.uid() is null
     or not public.current_user_has_permission('factory_raw_stock_check.create') then
    raise exception using errcode = '42501', message = 'Insufficient permission to preview a Raw Material Stock Check number.';
  end if;

  v_prefix := 'RMSC-' || to_char(v_date, 'YYMMDD');
  select coalesce(max((substring(stock_check.check_no from ('^' || v_prefix || '-([0-9]+)$')))::integer), 0) + 1
  into v_next
  from public.factory_raw_material_stock_checks stock_check
  where stock_check.check_no ~ ('^' || v_prefix || '-[0-9]+$');

  return v_prefix || '-' || public.factory_format_business_sequence(v_next);
end;
$$;

create or replace function public.factory_preview_finished_good_dispatch_no(
  p_dispatch_date date
)
returns text
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_date date := coalesce(p_dispatch_date, timezone('Asia/Kuala_Lumpur', now())::date);
  v_prefix text := 'D' || to_char(v_date, 'YYMMDD');
  v_next integer;
begin
  if auth.uid() is null
     or not public.current_user_has_permission('factory_finished_goods_dispatch.create') then
    raise exception using errcode = '42501', message = 'Insufficient permission to preview a Dispatch number.';
  end if;

  select coalesce(max((substring(dispatch.dispatch_no from ('^' || v_prefix || '-([0-9]+)$')))::integer), 0) + 1
  into v_next
  from public.factory_finished_good_dispatches dispatch
  where dispatch.dispatch_no ~ ('^' || v_prefix || '-[0-9]+$');

  return v_prefix || '-' || public.factory_format_business_sequence(v_next);
end;
$$;

revoke all on function public.factory_preview_job_order_no() from public, anon;
revoke all on function public.factory_preview_production_batch_no(date) from public, anon;
revoke all on function public.factory_preview_raw_material_receiving_no(date) from public, anon;
revoke all on function public.factory_preview_product_stock_check_no(date) from public, anon;
revoke all on function public.factory_preview_raw_material_stock_check_no(date) from public, anon;
revoke all on function public.factory_preview_finished_good_dispatch_no(date) from public, anon;

grant execute on function public.factory_preview_job_order_no() to authenticated;
grant execute on function public.factory_preview_production_batch_no(date) to authenticated;
grant execute on function public.factory_preview_raw_material_receiving_no(date) to authenticated;
grant execute on function public.factory_preview_product_stock_check_no(date) to authenticated;
grant execute on function public.factory_preview_raw_material_stock_check_no(date) to authenticated;
grant execute on function public.factory_preview_finished_good_dispatch_no(date) to authenticated;

-- Production Usage references use Production Batch, then exact Job Order. PRD is
-- retained in storage for legacy compatibility but is no longer a business reference.
create or replace function public.factory_list_raw_material_movements(
  p_batch_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_raw_material_id uuid default null,
  p_movement_type text default null,
  p_storage_location text default null,
  p_search text default null
)
returns table (
  id uuid, raw_material_id uuid, movement_type text, quantity numeric, uom text,
  reference_type text, reference_id uuid, reference_no text, movement_date date,
  notes text, created_by uuid, created_at timestamptz, created_by_name text,
  storage_location text, batch_no text, balance_after numeric, raw_material jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with enriched as (
    select movement.*,
      nullif(btrim(linked_job.job_order_no), '') as job_order_no,
      case
        when lower(coalesce(movement.reference_type, '')) = 'production' then coalesce(
          nullif(btrim(linked_production.batch_no), ''),
          nullif(btrim(linked_job.job_order_no), '')
        )
        else movement.reference_no
      end as display_reference_no
    from public.factory_list_raw_material_movements_v1(
      p_batch_id, p_date_from, p_date_to, p_raw_material_id,
      p_movement_type, p_storage_location, null
    ) movement
    left join public.factory_productions linked_production
      on lower(coalesce(movement.reference_type, '')) = 'production'
     and linked_production.id = coalesce(
       movement.reference_id,
       nullif(movement.raw_material ->> 'document_id', '')::uuid
     )
    left join public.factory_job_orders linked_job
      on linked_job.id = linked_production.job_order_id
  )
  select movement.id, movement.raw_material_id, movement.movement_type,
    movement.quantity, movement.uom, movement.reference_type,
    movement.reference_id, movement.display_reference_no, movement.movement_date,
    movement.notes, movement.created_by, movement.created_at,
    movement.created_by_name, movement.storage_location, movement.batch_no,
    movement.balance_after, movement.raw_material
  from enriched movement
  where nullif(btrim(p_search), '') is null
     or concat_ws(' ', movement.display_reference_no, movement.job_order_no,
       movement.batch_no, movement.raw_material ->> 'supplier_lot_no',
       movement.raw_material ->> 'material_code', movement.raw_material ->> 'name',
       movement.raw_material ->> 'name_en', movement.notes
     ) ilike '%' || btrim(p_search) || '%'
  order by movement.movement_date desc, movement.created_at desc, movement.id desc;
$$;

comment on function public.factory_list_raw_material_movements(
  uuid, date, date, uuid, text, text, text
) is 'Returns Raw Material Movements using Production Batch or exact Job Order references; PRD codes remain internal.';

do $$
begin
  if to_regprocedure(
    'public.factory_list_product_movements_business_refs_v1(date,date,text,uuid,text,text)'
  ) is null then
    alter function public.factory_list_product_movements(
      date, date, text, uuid, text, text
    ) rename to factory_list_product_movements_business_refs_v1;
  end if;
end;
$$;

create or replace function public.factory_list_product_movements(
  p_date_from date default null,
  p_date_to date default null,
  p_product_search text default null,
  p_category_id uuid default null,
  p_movement_type text default null,
  p_batch_source_search text default null
)
returns table (
  id uuid, finished_good_id uuid, product_name text, movement_type text,
  quantity numeric, uom text, reference_type text, reference_id uuid,
  dispatch_item_id uuid, reference_no text, movement_date date, notes text,
  created_by uuid, created_at timestamptz, batch_no text, source_reference text,
  balance_after numeric, finished_good jsonb, batch_count bigint,
  total_allocated_qty numeric, batch_summary text, batch_allocations jsonb,
  finished_good_name text, finished_good_name_cn text,
  storage_location_name text, storage_location_type text,
  storage_location_count bigint, missing_storage_location_count bigint,
  expiry_date date, earliest_expiry_date date, batch_metadata_diagnostic text
)
language sql
stable
security invoker
set search_path = public
as $$
  with enriched as (
    select movement.*,
      nullif(btrim(linked_production.batch_no), '') as production_batch_no,
      nullif(btrim(linked_job.job_order_no), '') as job_order_no
    from public.factory_list_product_movements_business_refs_v1(
      p_date_from, p_date_to, p_product_search, p_category_id,
      p_movement_type, null
    ) movement
    left join public.factory_productions linked_production
      on lower(coalesce(movement.reference_type, '')) = 'production'
     and linked_production.id = movement.reference_id
    left join public.factory_job_orders linked_job
      on linked_job.id = linked_production.job_order_id
  )
  select movement.id, movement.finished_good_id, movement.product_name,
    movement.movement_type, movement.quantity, movement.uom,
    movement.reference_type, movement.reference_id, movement.dispatch_item_id,
    case when lower(coalesce(movement.reference_type, '')) = 'production'
      then coalesce(movement.production_batch_no, movement.job_order_no)
      else movement.reference_no
    end,
    movement.movement_date, movement.notes, movement.created_by,
    movement.created_at, movement.batch_no,
    case when lower(coalesce(movement.reference_type, '')) = 'production'
      then coalesce(movement.production_batch_no, movement.job_order_no)
      else movement.source_reference
    end,
    movement.balance_after, movement.finished_good, movement.batch_count,
    movement.total_allocated_qty, movement.batch_summary,
    movement.batch_allocations, movement.finished_good_name,
    movement.finished_good_name_cn, movement.storage_location_name,
    movement.storage_location_type, movement.storage_location_count,
    movement.missing_storage_location_count, movement.expiry_date,
    movement.earliest_expiry_date, movement.batch_metadata_diagnostic
  from enriched movement
  where nullif(btrim(p_batch_source_search), '') is null
     or concat_ws(' ',
       (
         select string_agg(allocation ->> 'batch_no', ' ')
         from jsonb_array_elements(coalesce(movement.batch_allocations, '[]'::jsonb)) allocation
         where lower(coalesce(allocation ->> 'batch_type', '')) = 'production'
       ),
       case when lower(coalesce(movement.reference_type, '')) = 'production' then
         coalesce(movement.production_batch_no, movement.job_order_no)
       else concat_ws(' ', movement.reference_no, movement.source_reference) end,
       movement.notes
     ) ilike '%' || btrim(p_batch_source_search) || '%';
$$;

revoke all on function public.factory_list_product_movements_business_refs_v1(
  date, date, text, uuid, text, text
) from public, anon;
grant execute on function public.factory_list_product_movements_business_refs_v1(
  date, date, text, uuid, text, text
) to authenticated;
revoke all on function public.factory_list_product_movements(
  date, date, text, uuid, text, text
) from public, anon;
grant execute on function public.factory_list_product_movements(
  date, date, text, uuid, text, text
) to authenticated;

comment on function public.factory_list_product_movements(
  date, date, text, uuid, text, text
) is 'Returns Product Movements with exact batch metadata while excluding internal PRD codes from operator search.';
