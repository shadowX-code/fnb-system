-- Canonical Supplier <-> Raw Material eligibility for new Factory Receiving.
create table if not exists public.factory_supplier_raw_material_links (
  supplier_id uuid not null references public.factory_suppliers(id) on delete restrict,
  raw_material_id uuid not null references public.factory_raw_materials(id) on delete restrict,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (supplier_id, raw_material_id)
);

create index if not exists factory_supplier_raw_material_links_material_supplier_idx
  on public.factory_supplier_raw_material_links (raw_material_id, supplier_id);

alter table public.factory_supplier_raw_material_links enable row level security;

drop policy if exists "factory supplier material links view" on public.factory_supplier_raw_material_links;
create policy "factory supplier material links view"
on public.factory_supplier_raw_material_links for select to authenticated
using (
  public.current_user_has_permission('factory_suppliers.view')
  or public.current_user_has_permission('factory_suppliers.edit')
  or public.current_user_has_permission('factory_suppliers.manage')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_raw_receiving.create')
  or public.current_user_has_permission('factory_raw_receiving.edit')
);

revoke all on table public.factory_supplier_raw_material_links from anon, authenticated;
grant select on table public.factory_supplier_raw_material_links to authenticated;

-- Seed only proven current links. Historical receipt evidence itself remains unchanged.
insert into public.factory_supplier_raw_material_links (supplier_id, raw_material_id)
select distinct receiving.supplier_id, receiving.raw_material_id
from public.factory_raw_material_receivings receiving
join public.factory_suppliers supplier on supplier.id = receiving.supplier_id
join public.factory_raw_materials material on material.id = receiving.raw_material_id
where receiving.supplier_id is not null
  and receiving.raw_material_id is not null
  and lower(coalesce(supplier.status, '')) = 'active'
  and lower(coalesce(material.status, '')) = 'active'
on conflict (supplier_id, raw_material_id) do nothing;

create or replace function public.factory_supplier_raw_material_eligibility(
  p_supplier_id uuid,
  p_linked_only boolean default true
)
returns table (
  raw_material_id uuid,
  material_code text,
  name text,
  name_en text,
  name_cn text,
  category_id uuid,
  category text,
  uom text,
  storage_location_id uuid,
  storage_location text,
  expiry_tracking_mode text,
  image_url text,
  is_linked boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to view Supplier Raw Material eligibility.';
  end if;

  if not (
    public.current_user_has_permission('factory_suppliers.view')
    or public.current_user_has_permission('factory_suppliers.edit')
    or public.current_user_has_permission('factory_suppliers.manage')
    or public.current_user_has_permission('factory_raw_receiving.view')
    or public.current_user_has_permission('factory_raw_receiving.create')
    or public.current_user_has_permission('factory_raw_receiving.edit')
  ) then
    raise exception using errcode = '42501', message = 'Missing permission to view Supplier Raw Material eligibility.';
  end if;

  if not exists (
    select 1
    from public.factory_suppliers supplier
    where supplier.id = p_supplier_id
      and lower(coalesce(supplier.status, '')) = 'active'
  ) then
    return;
  end if;

  return query
  select
    material.id,
    material.material_code,
    material.name,
    material.name_en,
    material.name_cn,
    material.category_id,
    coalesce(category.name, material.category),
    material.uom,
    material.storage_location_id,
    material.storage_location,
    material.expiry_tracking_mode,
    material.image_url,
    exists (
      select 1
      from public.factory_supplier_raw_material_links link
      where link.supplier_id = p_supplier_id
        and link.raw_material_id = material.id
    )
  from public.factory_raw_materials material
  left join public.factory_raw_material_categories category on category.id = material.category_id
  where lower(coalesce(material.status, '')) = 'active'
    and (
      not p_linked_only
      or exists (
        select 1
        from public.factory_supplier_raw_material_links link
        where link.supplier_id = p_supplier_id
          and link.raw_material_id = material.id
      )
    )
  order by coalesce(nullif(material.name_en, ''), material.name), material.material_code, material.id;
end;
$$;

create or replace function public.factory_save_supplier_raw_material_links(
  p_supplier_id uuid,
  p_raw_material_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supplier public.factory_suppliers%rowtype;
  v_actor_id uuid;
  v_requested_ids uuid[] := coalesce(p_raw_material_ids, '{}');
  v_distinct_ids uuid[];
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to manage Supplier linked materials.';
  end if;

  if not (
    public.current_user_has_permission('factory_suppliers.edit')
    or public.current_user_has_permission('factory_suppliers.manage')
  ) then
    raise exception using errcode = '42501', message = 'Missing permission to manage Supplier linked materials.';
  end if;

  select employee.id into v_actor_id
  from public.employees employee
  where employee.auth_user_id = auth.uid()
    and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id
  limit 1;
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'An active employee profile is required to manage Supplier linked materials.';
  end if;

  select supplier.* into v_supplier
  from public.factory_suppliers supplier
  where supplier.id = p_supplier_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'Factory Supplier was not found.';
  end if;
  if lower(coalesce(v_supplier.status, '')) <> 'active' then
    raise exception using errcode = '22023', message = 'Archived Factory Suppliers cannot manage linked materials.';
  end if;

  select coalesce(array_agg(distinct value order by value), '{}') into v_distinct_ids
  from unnest(v_requested_ids) value;
  if cardinality(v_requested_ids) <> cardinality(v_distinct_ids) then
    raise exception using errcode = '22023', message = 'Linked Raw Materials must not contain duplicates.';
  end if;

  if exists (
    select 1
    from unnest(v_distinct_ids) requested(raw_material_id)
    left join public.factory_raw_materials material on material.id = requested.raw_material_id
    where material.id is null
       or lower(coalesce(material.status, '')) <> 'active'
  ) then
    raise exception using errcode = '22023', message = 'Only active Raw Materials can be linked to a Factory Supplier.';
  end if;

  delete from public.factory_supplier_raw_material_links link
  where link.supplier_id = v_supplier.id
    and not (link.raw_material_id = any(v_distinct_ids));

  insert into public.factory_supplier_raw_material_links (supplier_id, raw_material_id, created_by, updated_at)
  select v_supplier.id, requested.raw_material_id, v_actor_id, now()
  from unnest(v_distinct_ids) requested(raw_material_id)
  on conflict (supplier_id, raw_material_id) do update
  set updated_at = excluded.updated_at;

  return jsonb_build_object(
    'supplier_id', v_supplier.id,
    'linked_material_ids', coalesce((
      select jsonb_agg(link.raw_material_id order by link.raw_material_id)
      from public.factory_supplier_raw_material_links link
      where link.supplier_id = v_supplier.id
    ), '[]'::jsonb)
  );
end;
$$;

alter function public.factory_save_raw_material_receiving(uuid, uuid, uuid, text, date, text, jsonb, boolean)
  rename to factory_save_raw_material_receiving_impl_supplier_material_links_0908;

create function public.factory_save_raw_material_receiving(
  p_batch_id uuid,
  p_request_id uuid,
  p_supplier_id uuid,
  p_reference_no text,
  p_received_date date,
  p_remarks text,
  p_items jsonb,
  p_complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_raw_material_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to save Raw Material Receiving.';
  end if;

  if p_batch_id is null then
    if not public.current_user_has_permission('factory_raw_receiving.create') then
      raise exception using errcode = '42501', message = 'Missing permission to create Raw Material Receiving.';
    end if;
  elsif not public.current_user_has_permission('factory_raw_receiving.edit') then
    raise exception using errcode = '42501', message = 'Missing permission to edit Raw Material Receiving.';
  end if;

  if p_supplier_id is not null
    and p_items is not null
    and jsonb_typeof(p_items) = 'array'
  then
    for v_item in select value from jsonb_array_elements(p_items)
    loop
      v_raw_material_id := nullif(v_item->>'raw_material_id', '')::uuid;
      if v_raw_material_id is not null
        and not exists (
          select 1
          from public.factory_supplier_raw_material_links link
          join public.factory_raw_materials material on material.id = link.raw_material_id
          join public.factory_suppliers supplier on supplier.id = link.supplier_id
          where link.supplier_id = p_supplier_id
            and link.raw_material_id = v_raw_material_id
            and lower(coalesce(material.status, '')) = 'active'
            and lower(coalesce(supplier.status, '')) = 'active'
        )
      then
        raise exception using errcode = '22023', message = 'Raw Material is not linked to the selected Supplier.';
      end if;
    end loop;
  end if;

  return public.factory_save_raw_material_receiving_impl_supplier_material_links_0908(
    p_batch_id,
    p_request_id,
    p_supplier_id,
    p_reference_no,
    p_received_date,
    p_remarks,
    p_items,
    p_complete
  );
end;
$$;

revoke all on function public.factory_supplier_raw_material_eligibility(uuid, boolean) from public, anon;
revoke all on function public.factory_save_supplier_raw_material_links(uuid, uuid[]) from public, anon;
revoke all on function public.factory_save_raw_material_receiving_impl_supplier_material_links_0908(uuid, uuid, uuid, text, date, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.factory_save_raw_material_receiving(uuid, uuid, uuid, text, date, text, jsonb, boolean) from public, anon;
grant execute on function public.factory_supplier_raw_material_eligibility(uuid, boolean) to authenticated;
grant execute on function public.factory_save_supplier_raw_material_links(uuid, uuid[]) to authenticated;
grant execute on function public.factory_save_raw_material_receiving(uuid, uuid, uuid, text, date, text, jsonb, boolean) to authenticated;
