-- Canonical Raw Material standards and Receiving verification evidence.
-- MeSTI consumes the read-only projections below; it owns no duplicate ledger.

alter table public.factory_raw_materials
  add column if not exists acceptance_procedure text,
  add column if not exists control_methods text;

alter table public.factory_raw_material_receiving_batches
  add column if not exists verification_status text not null default 'not_required',
  add column if not exists verified_by uuid references public.employees(id),
  add column if not exists verified_at timestamptz;

alter table public.factory_raw_material_receiving_batches
  drop constraint if exists factory_raw_receiving_verification_status_check;

alter table public.factory_raw_material_receiving_batches
  add constraint factory_raw_receiving_verification_status_check
    check (verification_status in ('not_required', 'awaiting_verification', 'verified'));

alter table public.factory_raw_material_receivings
  add column if not exists acceptance_procedure_snapshot text,
  add column if not exists control_methods_snapshot text;

insert into public.permissions (code, module, description)
values ('factory_raw_receiving.verify', 'Raw Material Receiving', 'Verify completed Factory Raw Material Receiving documents.')
on conflict (code) do update set module = excluded.module, description = excluded.description;

create or replace function public.factory_raw_receiving_payload(p_batch_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(batch_row)
    || jsonb_build_object(
      'created_by_name', coalesce(creator.nickname, creator.full_name, ''),
      'completed_by_name', coalesce(completer.nickname, completer.full_name, ''),
      'verified_by_name', coalesce(verifier.nickname, verifier.full_name, ''),
      'cancelled_by_name', coalesce(canceller.nickname, canceller.full_name, ''),
      'supplier', case when supplier.id is null then null else jsonb_build_object('supplier_name', supplier.supplier_name) end,
      'items', coalesce(items.rows, '[]'::jsonb)
    )
  from public.factory_raw_material_receiving_batches batch_row
  left join public.employees creator on creator.id = batch_row.created_by
  left join public.employees completer on completer.id = batch_row.completed_by
  left join public.employees verifier on verifier.id = batch_row.verified_by
  left join public.employees canceller on canceller.id = batch_row.cancelled_by
  left join public.factory_suppliers supplier on supplier.id = batch_row.supplier_id
  left join lateral (
    select jsonb_agg(
      to_jsonb(item)
        || jsonb_build_object(
          'raw_material', jsonb_build_object(
            'material_code', material.material_code,
            'name', material.name,
            'name_en', material.name_en,
            'name_cn', material.name_cn,
            'name_bm', material.name_bm,
            'uom', material.uom,
            'expiry_tracking_mode', material.expiry_tracking_mode,
            'shelf_life_days', material.shelf_life_days
          ),
          'storage_location_ref', case when location.id is null then null else jsonb_build_object(
            'location_name', location.location_name,
            'location_code', location.location_code,
            'location_type', location.location_type,
            'status', location.status
          ) end
        ) order by item.created_at asc, item.id asc
    ) as rows
    from public.factory_raw_material_receivings item
    join public.factory_raw_materials material on material.id = item.raw_material_id
    left join public.factory_storage_locations location on location.id = item.storage_location_id
    where item.batch_id = batch_row.id
  ) items on true
  where batch_row.id = p_batch_id;
$$;

revoke all on function public.factory_raw_receiving_payload(uuid) from public, anon, authenticated;

create or replace function public.factory_snapshot_raw_receiving_control()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'draft' and new.status = 'completed' then
    update public.factory_raw_material_receivings item
    set acceptance_procedure_snapshot = material.acceptance_procedure,
        control_methods_snapshot = material.control_methods,
        updated_at = now()
    from public.factory_raw_materials material
    where item.batch_id = new.id and material.id = item.raw_material_id;

    update public.factory_raw_material_receiving_batches
    set verification_status = 'awaiting_verification', updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists factory_snapshot_raw_receiving_control on public.factory_raw_material_receiving_batches;
create trigger factory_snapshot_raw_receiving_control
after update of status on public.factory_raw_material_receiving_batches
for each row execute function public.factory_snapshot_raw_receiving_control();

create or replace function public.factory_verify_raw_material_receiving(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.employees%rowtype;
  v_batch public.factory_raw_material_receiving_batches%rowtype;
begin
  if auth.uid() is null or not public.current_user_has_permission('factory_raw_receiving.verify') then
    raise exception using errcode = '42501', message = 'Missing permission to verify Raw Material Receiving.';
  end if;

  select employee.* into v_actor from public.employees employee
  where employee.auth_user_id = auth.uid() and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id limit 1;
  if not found then raise exception using errcode = '42501', message = 'An active employee profile is required to verify Raw Material Receiving.'; end if;

  select batch_row.* into v_batch from public.factory_raw_material_receiving_batches batch_row
  where batch_row.id = p_batch_id for update;
  if not found then raise exception 'Raw Material Receiving was not found.'; end if;
  if v_batch.verification_status = 'verified' then return public.factory_raw_receiving_payload(v_batch.id); end if;
  if v_batch.status <> 'completed' or v_batch.verification_status <> 'awaiting_verification' then
    raise exception 'Only completed Receiving awaiting verification can be verified.';
  end if;
  if v_batch.completed_by = v_actor.id then
    raise exception using errcode = '42501', message = 'Received By cannot verify the same Receiving.';
  end if;

  update public.factory_raw_material_receiving_batches
  set verification_status = 'verified', verified_by = v_actor.id, verified_at = now(), updated_at = now()
  where id = v_batch.id;
  return public.factory_raw_receiving_payload(v_batch.id);
end;
$$;

grant execute on function public.factory_verify_raw_material_receiving(uuid) to authenticated;
revoke execute on function public.factory_verify_raw_material_receiving(uuid) from public, anon;

create or replace function public.factory_mesti_raw_material_control_standards()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'raw_material_id', material.id,
    'item', coalesce(material.name_en, material.name),
    'material_code', material.material_code,
    'acceptance_procedure', material.acceptance_procedure,
    'control_methods', material.control_methods
  ) order by coalesce(material.name_en, material.name), material.id), '[]'::jsonb)
  from public.factory_raw_materials material
  where lower(coalesce(material.status, '')) = 'active'
    and auth.uid() is not null
    and public.current_user_has_permission('factory_raw_receiving.view');
$$;

create or replace function public.factory_mesti_raw_material_control_receiving_report(
  p_date_from date default null,
  p_date_to date default null,
  p_raw_material_id uuid default null,
  p_supplier_id uuid default null,
  p_storage_location_id uuid default null,
  p_verification_status text default null,
  p_search text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(report_row) order by report_row.received_at desc, report_row.receiving_no desc), '[]'::jsonb)
  from (
    select item.id, batch_row.id as batch_id, item.raw_material_id, batch_row.batch_no as receiving_no,
      coalesce(batch_row.completed_at, item.created_at) as received_at, batch_row.received_date,
      coalesce(material.name_en, material.name) as item_name, material.material_code,
      batch_row.supplier_id, batch_row.supplier_name, item.received_qty, item.uom,
      item.storage_location_id, item.storage_location, batch_row.status,
      case when batch_row.verification_status = 'verified' then 'verified' when batch_row.verification_status = 'awaiting_verification' then 'awaiting_verification' else batch_row.status end as verification_status,
      item.acceptance_procedure_snapshot, item.control_methods_snapshot,
      coalesce(receiver.nickname, receiver.full_name, '') as received_by_name,
      coalesce(verifier.nickname, verifier.full_name, '') as verified_by_name,
      batch_row.verified_at, batch_row.reference_no
    from public.factory_raw_material_receivings item
    join public.factory_raw_material_receiving_batches batch_row on batch_row.id = item.batch_id
    join public.factory_raw_materials material on material.id = item.raw_material_id
    left join public.employees receiver on receiver.id = batch_row.completed_by
    left join public.employees verifier on verifier.id = batch_row.verified_by
    where auth.uid() is not null and public.current_user_has_permission('factory_raw_receiving.view')
      and batch_row.status = 'completed'
      and (p_date_from is null or batch_row.received_date >= p_date_from)
      and (p_date_to is null or batch_row.received_date <= p_date_to)
      and (p_raw_material_id is null or item.raw_material_id = p_raw_material_id)
      and (p_supplier_id is null or batch_row.supplier_id = p_supplier_id)
      and (p_storage_location_id is null or item.storage_location_id = p_storage_location_id)
      and (p_verification_status is null or batch_row.verification_status = p_verification_status)
      and (nullif(btrim(p_search), '') is null or concat_ws(' ', batch_row.batch_no, material.material_code, material.name_en, material.name, batch_row.supplier_name, item.storage_location, batch_row.reference_no) ilike '%' || btrim(p_search) || '%')
  ) report_row;
$$;

grant execute on function public.factory_mesti_raw_material_control_standards() to authenticated;
grant execute on function public.factory_mesti_raw_material_control_receiving_report(date, date, uuid, uuid, uuid, text, text) to authenticated;
revoke execute on function public.factory_mesti_raw_material_control_standards() from public, anon;
revoke execute on function public.factory_mesti_raw_material_control_receiving_report(date, date, uuid, uuid, uuid, text, text) from public, anon;
