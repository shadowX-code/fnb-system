-- Asset master media keeps an untouched source alongside normalized
-- presentation variants. Inspection evidence retains its existing contract.

alter table public.asset_items
  add column if not exists original_image_url text;

update public.asset_items
set original_image_url = image_url
where nullif(original_image_url, '') is null
  and nullif(image_url, '') is not null;

create or replace function public.crew_asset_initial_photo_result(
  p_token text,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_employee_id uuid := public.crew_session_employee(p_token);
  v_result jsonb;
begin
  if p_request_id is null then raise exception using errcode='22023',message='Photo request is required.'; end if;
  select r.result into v_result
  from public.asset_lifecycle_requests r
  join public.asset_items a on a.outlet_id=r.outlet_id
  where r.request_id=p_request_id
    and r.operation='asset_initial_photo'
    and a.id=(r.result->'asset'->>'id')::uuid
    and a.created_by_employee_id=v_employee_id;
  return v_result;
end;
$$;

revoke all on function public.crew_asset_initial_photo_result(text,uuid) from public, anon;
grant execute on function public.crew_asset_initial_photo_result(text,uuid) to anon, authenticated;

create or replace function public.crew_asset_set_initial_photo(
  p_token text,
  p_request_id uuid,
  p_asset_id uuid,
  p_original_image_url text,
  p_image_url text,
  p_thumbnail_url text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_context jsonb;
  v_employee_id uuid;
  v_outlet_id uuid;
  v_asset public.asset_items%rowtype;
  v_result jsonb;
begin
  if p_request_id is null
     or nullif(btrim(p_original_image_url),'') is null
     or nullif(btrim(p_image_url),'') is null
     or nullif(btrim(p_thumbnail_url),'') is null
     or p_original_image_url !~ '^https?://'
     or p_image_url !~ '^https?://'
     or p_thumbnail_url !~ '^https?://' then
    raise exception using errcode='22023',message='A valid asset photo bundle is required.';
  end if;
  perform pg_advisory_xact_lock(hashtext('asset_lifecycle_'||p_request_id::text));
  select result into v_result from public.asset_lifecycle_requests where request_id=p_request_id and operation='asset_initial_photo';
  if found then return v_result; end if;
  if exists(select 1 from public.asset_lifecycle_requests where request_id=p_request_id) then raise exception 'Request ID was already used for another asset action.'; end if;
  v_context := public.crew_asset_initial_photo_context(p_token,p_asset_id);
  v_employee_id := (v_context->>'employee_id')::uuid;
  v_outlet_id := (v_context->>'outlet_id')::uuid;
  update public.asset_items
  set original_image_url=btrim(p_original_image_url),
      image_url=btrim(p_image_url),
      thumbnail_url=btrim(p_thumbnail_url),
      updated_at=now()
  where id=p_asset_id
    and outlet_id=v_outlet_id
    and created_by_employee_id=v_employee_id
    and nullif(image_url,'') is null
    and created_at >= now() - interval '15 minutes'
  returning * into v_asset;
  if not found then raise exception using errcode='42501',message='Initial asset photo is no longer available.'; end if;
  v_result:=jsonb_build_object('asset',jsonb_build_object(
    'id',v_asset.id,
    'original_image_url',v_asset.original_image_url,
    'image_url',v_asset.image_url,
    'thumbnail_url',v_asset.thumbnail_url),
    'actor_employee_id',v_employee_id,
    'request_id',p_request_id);
  insert into public.asset_lifecycle_requests(request_id,operation,actor_employee_id,outlet_id,result)
  values(p_request_id,'asset_initial_photo',v_employee_id,v_outlet_id,v_result);
  return v_result;
end;
$$;

revoke all on function public.crew_asset_set_initial_photo(text,uuid,uuid,text,text,text) from public, anon;
grant execute on function public.crew_asset_set_initial_photo(text,uuid,uuid,text,text,text) to anon, authenticated;
drop function if exists public.crew_asset_set_initial_photo(text,uuid,uuid,text);

create or replace function public.crew_asset_mobile(p_token text, p_asset_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_context jsonb:=public.crew_asset_context(p_token); v_employee_id uuid:=(v_context->>'employee_id')::uuid; v_outlet_id uuid:=(v_context->>'outlet_id')::uuid; v_outlet_name text;
begin
  select name into v_outlet_name from public.outlets where id=v_outlet_id;
  if p_asset_id is not null and not exists(select 1 from public.asset_items where id=p_asset_id and outlet_id=v_outlet_id and status<>'archived') then raise exception using errcode='42501',message='Asset is unavailable for this Crew outlet.'; end if;
  return v_context || jsonb_build_object(
    'outlet',jsonb_build_object('id',v_outlet_id,'name',v_outlet_name),
    'categories',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.sort_order,c.name) from public.asset_categories c where c.is_active),'[]'::jsonb),
    'condition_templates',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'category_id',t.category_id,'name',t.name,'severity',t.severity,'requires_photo',t.requires_photo,'requires_remark',t.requires_remark) order by t.sort_order,t.name) from public.asset_condition_templates t where t.active),'[]'::jsonb),
    'assets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'asset_code',a.asset_code,'name',a.name,'description',a.description,'category_id',a.category_id,'category_name',c.name,'location',a.location,'unit',a.unit,'current_quantity',a.current_quantity,'minimum_quantity',a.minimum_quantity,'condition',a.condition,'status',a.status,'original_image_url',a.original_image_url,'image_url',a.image_url,'thumbnail_url',a.thumbnail_url,'last_inspection_at',a.last_inspection_at,'maintenance',coalesce((select jsonb_agg(jsonb_build_object('status',m.status,'scheduled_date',m.scheduled_date,'issue',m.issue) order by coalesce(m.scheduled_date,m.date) desc) from public.asset_maintenance_records m where m.asset_id=a.id and m.status in ('scheduled','in_progress')),'[]'::jsonb)) order by a.name) from public.asset_items a join public.asset_categories c on c.id=a.category_id where a.outlet_id=v_outlet_id and a.status<>'archived' and (p_asset_id is null or a.id=p_asset_id)),'[]'::jsonb),
    'inspection_drafts',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'inspection_date',i.inspection_date,'category_scope',i.category_scope,'status',i.status,'current_step',i.current_step,'completion_percentage',i.completion_percentage,'draft_data',i.draft_data,'updated_at',i.updated_at) order by i.updated_at desc) from public.asset_inspections i where i.outlet_id=v_outlet_id and i.checked_by_employee_id=v_employee_id and i.status in ('draft','in_progress','pending_review')),'[]'::jsonb),
    'movement_history',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'asset_id',m.asset_id,'asset_name',a.name,'movement_type',m.movement_type,'quantity_before',m.quantity_before,'quantity_after',m.quantity_after,'quantity_change',m.quantity_change,'reason',m.reason,'movement_date',m.movement_date,'created_at',m.created_at,'actor_name',coalesce(e.full_name,case when m.created_by_employee_id=v_employee_id then 'You' else 'Admin' end)) order by m.created_at desc) from (select * from public.asset_movement_logs where outlet_id=v_outlet_id and (p_asset_id is null or asset_id=p_asset_id) order by created_at desc limit 40) m join public.asset_items a on a.id=m.asset_id left join public.employees e on e.id=m.created_by_employee_id),'[]'::jsonb),
    'inspection_history',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'inspection_date',i.inspection_date,'checked_by',i.checked_by,'status',i.status,'summary',i.summary,'notes',i.notes,'created_at',i.created_at,'asset_ids',coalesce((select jsonb_agg(ii.asset_id) from public.asset_inspection_items ii where ii.inspection_id=i.id),'[]'::jsonb),'items',coalesce((select jsonb_agg(jsonb_build_object('asset_id',ii.asset_id,'asset_name',a.name,'expected_quantity',coalesce(ii.expected_quantity,ii.expected_qty),'counted_quantity',coalesce(ii.counted_quantity,ii.counted_qty),'difference',ii.difference,'condition',coalesce(ii.condition,ii.condition_status)) order by a.name) from public.asset_inspection_items ii join public.asset_items a on a.id=ii.asset_id where ii.inspection_id=i.id),'[]'::jsonb)) order by i.inspection_date desc,i.created_at desc) from (select * from public.asset_inspections where outlet_id=v_outlet_id and status in ('completed','partial','submitted') and (p_asset_id is null or exists(select 1 from public.asset_inspection_items ii where ii.inspection_id=asset_inspections.id and ii.asset_id=p_asset_id)) order by inspection_date desc,created_at desc limit 20) i),'[]'::jsonb)
  );
end;
$$;
