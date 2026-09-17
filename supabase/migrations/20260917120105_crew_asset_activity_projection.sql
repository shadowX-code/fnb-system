-- Crew Activity remains a minimum-safe projection of canonical movement and
-- inspection evidence. It does not create a Crew-owned event store.
create or replace function public.crew_asset_mobile(p_token text, p_asset_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context jsonb := public.crew_asset_context(p_token);
  v_employee_id uuid := (v_context->>'employee_id')::uuid;
  v_outlet_id uuid := (v_context->>'outlet_id')::uuid;
  v_outlet_name text;
begin
  select name into v_outlet_name from public.outlets where id = v_outlet_id;
  if p_asset_id is not null and not exists (select 1 from public.asset_items where id=p_asset_id and outlet_id=v_outlet_id and status <> 'archived') then
    raise exception using errcode='42501',message='Asset is unavailable for this Crew outlet.';
  end if;

  return v_context || jsonb_build_object(
    'outlet',jsonb_build_object('id',v_outlet_id,'name',v_outlet_name),
    'categories',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.sort_order,c.name) from public.asset_categories c where c.is_active),'[]'::jsonb),
    'condition_templates',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'category_id',t.category_id,'name',t.name,'severity',t.severity,'requires_photo',t.requires_photo,'requires_remark',t.requires_remark) order by t.sort_order,t.name) from public.asset_condition_templates t where t.active),'[]'::jsonb),
    'assets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'asset_code',a.asset_code,'name',a.name,'description',a.description,'category_id',a.category_id,'category_name',c.name,'location',a.location,'unit',a.unit,'current_quantity',a.current_quantity,'minimum_quantity',a.minimum_quantity,'condition',a.condition,'status',a.status,'image_url',a.image_url,'thumbnail_url',a.thumbnail_url,'last_inspection_at',a.last_inspection_at,'maintenance',coalesce((select jsonb_agg(jsonb_build_object('status',m.status,'scheduled_date',m.scheduled_date,'issue',m.issue) order by coalesce(m.scheduled_date,m.date) desc) from public.asset_maintenance_records m where m.asset_id=a.id and m.status in ('scheduled','in_progress')),'[]'::jsonb)) order by a.name) from public.asset_items a join public.asset_categories c on c.id=a.category_id where a.outlet_id=v_outlet_id and a.status <> 'archived' and (p_asset_id is null or a.id=p_asset_id)),'[]'::jsonb),
    'inspection_drafts',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'inspection_date',i.inspection_date,'category_scope',i.category_scope,'status',i.status,'current_step',i.current_step,'completion_percentage',i.completion_percentage,'draft_data',i.draft_data,'updated_at',i.updated_at) order by i.updated_at desc) from public.asset_inspections i where i.outlet_id=v_outlet_id and i.checked_by_employee_id=v_employee_id and i.status in ('draft','in_progress','pending_review')),'[]'::jsonb),
    'movement_history',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'asset_id',m.asset_id,'asset_name',a.name,'movement_type',m.movement_type,'quantity_before',m.quantity_before,'quantity_after',m.quantity_after,'quantity_change',m.quantity_change,'reason',m.reason,'movement_date',m.movement_date,'created_at',m.created_at,'actor_name',coalesce(e.full_name,case when m.created_by_employee_id=v_employee_id then 'You' else 'Admin' end)) order by m.created_at desc) from (select * from public.asset_movement_logs where outlet_id=v_outlet_id and (p_asset_id is null or asset_id=p_asset_id) order by created_at desc limit 40) m join public.asset_items a on a.id=m.asset_id left join public.employees e on e.id=m.created_by_employee_id),'[]'::jsonb),
    'inspection_history',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'inspection_date',i.inspection_date,'checked_by',i.checked_by,'status',i.status,'summary',i.summary,'notes',i.notes,'created_at',i.created_at,'asset_ids',coalesce((select jsonb_agg(ii.asset_id) from public.asset_inspection_items ii where ii.inspection_id=i.id),'[]'::jsonb)) order by i.inspection_date desc,i.created_at desc) from (select * from public.asset_inspections where outlet_id=v_outlet_id and status in ('completed','partial','submitted') and (p_asset_id is null or exists(select 1 from public.asset_inspection_items ii where ii.inspection_id=asset_inspections.id and ii.asset_id=p_asset_id)) order by inspection_date desc,created_at desc limit 20) i),'[]'::jsonb)
  );
end;
$$;
