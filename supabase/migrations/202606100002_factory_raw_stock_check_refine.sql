-- Factory Raw Material Stock Check refinement.
-- Adds category-first raw stock checks, draft delete permission, and skipped-row approval safety.

alter table public.factory_raw_material_stock_checks
  add column if not exists category_id uuid references public.factory_raw_material_categories(id) on delete set null;

alter table public.factory_raw_material_stock_check_items
  add column if not exists count_status text not null default 'counted';

insert into public.permissions (code, module, description)
values
  ('factory_raw_stock_check.delete', 'Raw Material Stock Check', 'Delete Factory Raw Material Stock Check drafts.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

drop policy if exists "factory raw stock checks manage" on public.factory_raw_material_stock_checks;
create policy "factory raw stock checks manage" on public.factory_raw_material_stock_checks for all to authenticated
using (
  public.current_user_has_permission('factory_raw_stock_check.create')
  or public.current_user_has_permission('factory_raw_stock_check.edit')
  or public.current_user_has_permission('factory_raw_stock_check.delete')
  or public.current_user_has_permission('factory_raw_stock_check.submit')
  or public.current_user_has_permission('factory_raw_stock_check.approve')
)
with check (
  public.current_user_has_permission('factory_raw_stock_check.create')
  or public.current_user_has_permission('factory_raw_stock_check.edit')
  or public.current_user_has_permission('factory_raw_stock_check.delete')
  or public.current_user_has_permission('factory_raw_stock_check.submit')
  or public.current_user_has_permission('factory_raw_stock_check.approve')
);

drop policy if exists "factory raw stock check items manage" on public.factory_raw_material_stock_check_items;
create policy "factory raw stock check items manage" on public.factory_raw_material_stock_check_items for all to authenticated
using (
  public.current_user_has_permission('factory_raw_stock_check.create')
  or public.current_user_has_permission('factory_raw_stock_check.edit')
  or public.current_user_has_permission('factory_raw_stock_check.delete')
  or public.current_user_has_permission('factory_raw_stock_check.submit')
  or public.current_user_has_permission('factory_raw_stock_check.approve')
)
with check (
  public.current_user_has_permission('factory_raw_stock_check.create')
  or public.current_user_has_permission('factory_raw_stock_check.edit')
  or public.current_user_has_permission('factory_raw_stock_check.delete')
  or public.current_user_has_permission('factory_raw_stock_check.submit')
  or public.current_user_has_permission('factory_raw_stock_check.approve')
);

create or replace function public.factory_create_raw_material_stock_check(
  p_category_id uuid,
  p_check_date date,
  p_notes text,
  p_rows jsonb
)
returns table(id uuid, check_no text)
language plpgsql
security invoker
as $$
declare
  v_check_date date := coalesce(p_check_date, current_date);
  v_yymmdd text := to_char(coalesce(p_check_date, current_date), 'YYMMDD');
  v_next integer;
  v_check_id uuid;
  v_check_no text;
  v_created_by uuid;
  v_row jsonb;
begin
  if not public.current_user_has_permission('factory_raw_stock_check.create') then
    raise exception 'Missing permission to create raw material stock checks.';
  end if;

  if p_category_id is null then
    raise exception 'Category is required for raw material stock check.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Stock check requires at least one item row.';
  end if;

  select e.id into v_created_by
  from public.employees e
  where e.auth_user_id = auth.uid()
     or lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  order by e.created_at desc nulls last
  limit 1;

  perform pg_advisory_xact_lock(hashtextextended('factory_raw_material_stock_check:RMSC:' || v_yymmdd, 0));

  select coalesce(max((substring(check_no from ('^RMSC-' || v_yymmdd || '-([0-9]+)$')))::integer), 0) + 1
  into v_next
  from public.factory_raw_material_stock_checks
  where check_no ~ ('^RMSC-' || v_yymmdd || '-[0-9]+$');

  v_check_no := 'RMSC-' || v_yymmdd || '-' || lpad(v_next::text, 3, '0');

  insert into public.factory_raw_material_stock_checks (
    check_no,
    check_date,
    category_id,
    status,
    notes,
    created_by,
    updated_at
  )
  values (
    v_check_no,
    v_check_date,
    p_category_id,
    'draft',
    coalesce(p_notes, ''),
    v_created_by,
    now()
  )
  returning factory_raw_material_stock_checks.id into v_check_id;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    insert into public.factory_raw_material_stock_check_items (
      stock_check_id,
      raw_material_id,
      system_qty,
      physical_qty,
      variance_qty,
      variance_percent,
      count_status,
      variance_status,
      variance_reason,
      uom,
      updated_at
    )
    values (
      v_check_id,
      nullif(v_row ->> 'raw_material_id', '')::uuid,
      coalesce((v_row ->> 'system_qty')::numeric, 0),
      coalesce((v_row ->> 'physical_qty')::numeric, coalesce((v_row ->> 'system_qty')::numeric, 0)),
      coalesce((v_row ->> 'variance_qty')::numeric, 0),
      coalesce((v_row ->> 'variance_percent')::numeric, 0),
      coalesce(nullif(v_row ->> 'count_status', ''), 'counted'),
      coalesce(nullif(v_row ->> 'variance_status', ''), 'Normal'),
      coalesce(v_row ->> 'variance_reason', ''),
      coalesce(v_row ->> 'uom', ''),
      now()
    );
  end loop;

  return query select v_check_id, v_check_no;
end;
$$;

grant execute on function public.factory_create_raw_material_stock_check(uuid, date, text, jsonb) to authenticated;

create or replace function public.factory_approve_raw_material_stock_check(
  p_stock_check_id uuid,
  p_approved_by uuid
)
returns void
language plpgsql
security invoker
as $$
declare
  v_check public.factory_raw_material_stock_checks%rowtype;
  v_item record;
begin
  select * into v_check
  from public.factory_raw_material_stock_checks
  where id = p_stock_check_id
  for update;

  if v_check.id is null then
    raise exception 'Raw material stock check not found.';
  end if;

  if v_check.status <> 'submitted' then
    raise exception 'Only submitted stock checks can be approved.';
  end if;

  if not exists (select 1 from public.factory_raw_material_stock_check_items where stock_check_id = p_stock_check_id) then
    raise exception 'Stock check requires at least one counted item.';
  end if;

  for v_item in
    select item.*, material.name
    from public.factory_raw_material_stock_check_items item
    join public.factory_raw_materials material on material.id = item.raw_material_id
    where item.stock_check_id = p_stock_check_id
  loop
    if coalesce(v_item.count_status, 'counted') = 'pending' then
      raise exception 'All stock check items must be counted or skipped before approval.';
    end if;

    if v_item.variance_status = 'Skipped' then
      if coalesce(trim(v_item.variance_reason), '') = '' then
        raise exception 'Skip reason is required for skipped stock check items.';
      end if;
      continue;
    end if;

    if v_item.variance_status in ('Warning', 'Critical') and coalesce(trim(v_item.variance_reason), '') = '' then
      raise exception 'Variance reason is required for Warning and Critical stock check items.';
    end if;

    if v_item.variance_qty <> 0 then
      perform public.factory_adjust_raw_material_balance(v_item.raw_material_id, v_item.variance_qty);

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
        v_item.raw_material_id,
        'Stock Check Adjustment',
        v_item.variance_qty,
        v_item.uom,
        'raw_material_stock_check',
        p_stock_check_id,
        v_check.check_no,
        coalesce(v_check.check_date, current_date),
        'Approved raw material stock check adjustment. Physical count variance is separate from production recipe variance.',
        p_approved_by
      );
    end if;
  end loop;

  update public.factory_raw_material_stock_checks
  set status = 'approved',
      approved_by = p_approved_by,
      approved_at = now(),
      updated_at = now()
  where id = p_stock_check_id;
end;
$$;

grant execute on function public.factory_approve_raw_material_stock_check(uuid, uuid) to authenticated;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where lower(r.name) in ('owner', 'admin')
  and p.code like 'factory_%'
on conflict do nothing;
