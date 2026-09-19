-- A photo-inclusive Crew create is one business operation. Storage is staged
-- before this RPC; this transaction makes the Asset visible only once its
-- complete master-photo bundle is available.
alter table public.asset_lifecycle_requests
  drop constraint if exists asset_lifecycle_requests_operation_check;
alter table public.asset_lifecycle_requests
  add constraint asset_lifecycle_requests_operation_check
  check (operation in (
    'quantity_adjustment', 'inspection_submission', 'inspection_archive',
    'maintenance_save', 'import_row', 'asset_creation', 'asset_initial_photo'
  ));

create or replace function public.crew_asset_create_result(
  p_token text,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid := public.crew_session_employee(p_token);
  v_result jsonb;
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'A request ID is required.';
  end if;

  select r.result into v_result
  from public.asset_lifecycle_requests r
  join public.asset_items a on a.id = (r.result -> 'asset' ->> 'id')::uuid
  where r.request_id = p_request_id
    and r.operation = 'asset_creation'
    and r.actor_employee_id = v_employee_id
    and a.created_by_employee_id = v_employee_id;

  return v_result;
end;
$$;

create or replace function public.crew_asset_create_context(
  p_token text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_context jsonb := public.crew_asset_context(p_token);
begin
  if not coalesce((v_context ->> 'can_add_assets')::boolean, false) then
    raise exception using errcode = '42501', message = 'Add Assets Special Access is required.';
  end if;

  return jsonb_build_object(
    'employee_id', (v_context ->> 'employee_id')::uuid,
    'outlet_id', (v_context ->> 'outlet_id')::uuid,
    'bucket', 'asset-photos'
  );
end;
$$;

create or replace function public.crew_asset_create_with_photo(
  p_token text,
  p_request_id uuid,
  p_asset jsonb,
  p_original_image_url text,
  p_image_url text,
  p_thumbnail_url text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_context jsonb := public.crew_asset_context(p_token);
  v_employee_id uuid := (v_context ->> 'employee_id')::uuid;
  v_outlet_id uuid := (v_context ->> 'outlet_id')::uuid;
  v_category_id uuid;
  v_name text;
  v_unit text;
  v_code text;
  v_location text;
  v_description text;
  v_quantity numeric;
  v_asset public.asset_items%rowtype;
  v_result jsonb;
begin
  if not coalesce((v_context ->> 'can_add_assets')::boolean, false) then
    raise exception using errcode = '42501', message = 'Add Assets Special Access is required.';
  end if;
  if p_request_id is null
     or nullif(btrim(p_original_image_url), '') is null
     or nullif(btrim(p_image_url), '') is null
     or nullif(btrim(p_thumbnail_url), '') is null
     or p_original_image_url !~ '^https?://'
     or p_image_url !~ '^https?://'
     or p_thumbnail_url !~ '^https?://' then
    raise exception using errcode = '22023', message = 'A complete asset photo bundle is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext('asset_lifecycle_' || p_request_id::text));
  select result into v_result
  from public.asset_lifecycle_requests
  where request_id = p_request_id and operation = 'asset_creation';
  if found then return v_result; end if;
  if exists(select 1 from public.asset_lifecycle_requests where request_id = p_request_id) then
    raise exception using errcode = '22023', message = 'Request ID was already used for another asset action.';
  end if;

  begin
    v_category_id := nullif(p_asset ->> 'category_id', '')::uuid;
    v_quantity := coalesce(nullif(p_asset ->> 'initial_quantity', '')::numeric, 0);
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'Asset category and quantity must be valid.';
  end;
  v_name := nullif(btrim(p_asset ->> 'name'), '');
  v_unit := lower(nullif(btrim(p_asset ->> 'unit'), ''));
  v_code := nullif(btrim(p_asset ->> 'asset_code'), '');
  v_location := coalesce(nullif(btrim(p_asset ->> 'location'), ''), '');
  v_description := coalesce(nullif(btrim(p_asset ->> 'description'), ''), '');

  if v_name is null or v_category_id is null or v_unit is null then
    raise exception using errcode = '22023', message = 'Asset name, category and unit are required.';
  end if;
  if v_quantity < 0 then raise exception using errcode = '22023', message = 'Initial quantity cannot be below 0.'; end if;
  if v_unit not in ('unit', 'piece', 'set', 'box', 'bottle', 'pair') then
    raise exception using errcode = '22023', message = 'Choose a supported asset unit.';
  end if;
  if not exists(select 1 from public.asset_categories where id = v_category_id and is_active) then
    raise exception using errcode = '22023', message = 'Choose an active asset category.';
  end if;
  if v_code is not null and exists(
    select 1 from public.asset_items
    where outlet_id = v_outlet_id and lower(asset_code) = lower(v_code) and status <> 'archived'
  ) then
    raise exception using errcode = '23505', message = 'Asset code is already in use for this outlet.';
  end if;

  insert into public.asset_items(
    outlet_id, category_id, name, description, asset_code, location, unit,
    current_quantity, minimum_quantity, status, health_status,
    maintenance_override, condition, remark, created_by_employee_id,
    original_image_url, image_url, thumbnail_url, created_at, updated_at
  ) values (
    v_outlet_id, v_category_id, v_name, v_description, v_code, v_location,
    v_unit, v_quantity, 0, 'active', 'healthy', 'inherit', 'healthy', '',
    v_employee_id, btrim(p_original_image_url), btrim(p_image_url),
    btrim(p_thumbnail_url), now(), now()
  ) returning * into v_asset;

  v_result := jsonb_build_object(
    'asset', jsonb_build_object(
      'id', v_asset.id, 'outlet_id', v_asset.outlet_id, 'name', v_asset.name,
      'current_quantity', v_asset.current_quantity, 'unit', v_asset.unit,
      'original_image_url', v_asset.original_image_url,
      'image_url', v_asset.image_url, 'thumbnail_url', v_asset.thumbnail_url
    ),
    'actor_employee_id', v_employee_id,
    'request_id', p_request_id
  );
  insert into public.asset_lifecycle_requests(request_id, operation, actor_employee_id, outlet_id, result)
  values (p_request_id, 'asset_creation', v_employee_id, v_outlet_id, v_result);
  return v_result;
end;
$$;

revoke all on function public.crew_asset_create_result(text, uuid) from public, anon;
revoke all on function public.crew_asset_create_context(text) from public, anon;
revoke all on function public.crew_asset_create_with_photo(text, uuid, jsonb, text, text, text) from public, anon;
grant execute on function public.crew_asset_create_result(text, uuid) to anon, authenticated;
grant execute on function public.crew_asset_create_context(text) to anon, authenticated;
grant execute on function public.crew_asset_create_with_photo(text, uuid, jsonb, text, text, text) to anon, authenticated;
